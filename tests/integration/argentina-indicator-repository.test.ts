import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createLiveIndecSource } from "@/modules/macro-series/application/live-indec-source";
import {
  recordArgentinaIndicator,
  type ArgentinaIndicatorSource,
} from "@/modules/macro-series/application/record-argentina-indicator";
import { readIndicatorVintages } from "@/modules/macro-series/domain/argentina-indicator";
import { DECLARED_ARGENTINA_INDICATORS } from "@/modules/macro-series/domain/declared-argentina-indicators";
import {
  DECLARED_INDEC_EXPANDED_INDICATORS,
  declaredIndecExpandedIndicator,
} from "@/modules/macro-series/domain/declared-indec-expanded-indicators";
import { createPostgresArgentinaIndicatorRepository } from "@/server/db/postgres-argentina-indicator-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import * as schema from "@/server/db/schema";
import { INDEC_WAGES_LEVEL_ROWS } from "../fixtures/indec-expanded-rows";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const indicator = DECLARED_ARGENTINA_INDICATORS[0]!;
const expanded = declaredIndecExpandedIndicator("ipc_nacional")!;
const wages = declaredIndecExpandedIndicator("wages_general")!;

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function clean() {
  await database.delete(schema.argentinaIndicatorObservations);
  await database.delete(schema.argentinaIndicatorDefinitions);
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, indicator.sourceId));
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, expanded.sourceId));
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 4 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  await clean();
  await sql.end({ timeout: 5 });
});

beforeEach(clean);

function months(count: number, last = String(100 + count - 1)) {
  return Array.from({ length: count }, (_, index) => ({
    periodOn: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`,
    value: index === count - 1 ? last : String(100 + index),
  }));
}

function setup() {
  let points = months(24);
  let tick = Date.parse("2026-11-03T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const source: ArgentinaIndicatorSource = {
    sourceId: indicator.sourceId,
    datasetId: "argentina.series-observations",
    parserVersion: "argentina-series-api-1.0.0",
    async load() {
      return { points, observedAt: clock(), requests: 1, bytes: 100 };
    },
  };
  const repository = createPostgresArgentinaIndicatorRepository(database);
  return {
    repository,
    dependencies: {
      sources: [source],
      repository,
      ingestionRuns: createPostgresIngestionRunRepository(database),
      now: clock,
      newId: () => randomUUID(),
    },
    setPoints(next: typeof points) {
      points = next;
    },
  };
}

describe("PostgreSQL Argentina indicator repository", () => {
  it("publishes a revision chain readable at each cutoff", async () => {
    const { repository, dependencies, setPoints } = setup();
    const first = await recordArgentinaIndicator(indicator, dependencies);
    expect(first.runStatus).toBe("succeeded");

    setPoints(months(24, "999.25"));
    const second = await recordArgentinaIndicator(indicator, dependencies);
    expect(second.plan.counts.revised).toBe(1);

    const again = await recordArgentinaIndicator(indicator, dependencies);
    expect(again.runStatus).toBe("duplicate");

    const all = await repository.allObservations(indicator.id);
    expect(all).toHaveLength(25);
    const batch = await repository.allObservationsOf([indicator.id, "emae_sa"]);
    expect(batch.get(indicator.id)).toEqual(all);
    expect(batch.get("emae_sa")).toEqual([]);
    const at = (knownAt: string) =>
      readIndicatorVintages(indicator, all, {
        effectiveOn: "2026-11-03",
        knownAt,
        knowledgeBasis: "system_recorded",
      }).at(-1);
    expect(at(first.fetched.observedAt)).toBeUndefined();
    expect(at(second.fetched.observedAt)).toMatchObject({ value: "123" });
    expect(at("2026-11-04T00:00:00.000Z")).toMatchObject({
      value: "999.25",
      revision: 1,
      segment: indicator.segment,
    });
  });

  it("keeps one open revision per date when a stale plan is applied", async () => {
    const { repository, dependencies, setPoints } = setup();
    await recordArgentinaIndicator(indicator, dependencies);
    setPoints(months(24, "500"));
    const stale = await recordArgentinaIndicator(indicator, {
      ...dependencies,
      dryRun: true,
    });
    await recordArgentinaIndicator(indicator, dependencies);

    await expect(repository.apply(stale.plan, indicator.id)).rejects.toThrow();
    expect(
      (await repository.openObservations(indicator.id)).at(-1)?.value,
    ).toBe("500");
  });

  it("records a withdrawn date as a null with its reason", async () => {
    const { repository, dependencies, setPoints } = setup();
    await recordArgentinaIndicator(indicator, dependencies);
    setPoints(months(23));
    await recordArgentinaIndicator(indicator, dependencies);
    expect(
      (await repository.openObservations(indicator.id)).at(-1),
    ).toMatchObject({
      value: null,
      missingReason: "withdrawn",
    });
  });

  it("publishes only reconciled IPC levels and keeps their revisions", async () => {
    let latest = 102;
    let publishedRate: number | null = null;
    let fetchedAt = 0;
    const fetch: EgressFetch = async ({ url }) => {
      const rate =
        new URL(url).searchParams.get("tipo_de_indicador") === "eq.v_m";
      const filters = rate
        ? {
            ...expanded.filters,
            tipo_de_indicador: "v_m",
            tipo_de_indicador_descripcion:
              "Variación porcentual respecto del período anterior",
            unidad_de_medida: "Porcentaje",
          }
        : expanded.filters;
      const row = (periodo: string, valor: number) => ({
        ...filters,
        periodo,
        anio: Number(periodo.slice(0, 4)),
        mes: Number(periodo.slice(4)),
        valor,
        valor_null: null,
        observaciones: null,
      });
      const body = new TextEncoder().encode(
        JSON.stringify(
          rate
            ? [row("202609", publishedRate ?? latest - 100)]
            : [row("202608", 100), row("202609", latest)],
        ),
      );
      fetchedAt += 1;
      return {
        status: 200,
        body,
        byteLength: body.byteLength,
        fetchedAt: new Date(
          Date.parse("2026-11-05T12:00:00.000Z") + fetchedAt * 1000,
        ).toISOString(),
      };
    };
    const repository = createPostgresArgentinaIndicatorRepository(database);
    const dependencies = {
      sources: [
        createLiveIndecSource({
          sourceRegistry:
            createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY),
          fetch,
        }),
      ],
      repository,
      ingestionRuns: createPostgresIngestionRunRepository(database),
      now: () => "2026-11-05T12:01:00.000Z",
      newId: () => randomUUID(),
    };
    const first = await recordArgentinaIndicator(expanded, dependencies);
    expect(first.runStatus).toBe("succeeded");
    expect(first.fetched.reconciliation).toMatchObject({
      status: "matched",
      published: "2",
    });

    latest = 103;
    const second = await recordArgentinaIndicator(expanded, dependencies);
    expect(second.runStatus).toBe("succeeded");
    expect(second.fetched.reconciliation).toMatchObject({
      status: "matched",
      published: "3",
    });
    const all = await repository.allObservations(expanded.id);
    expect(all).toHaveLength(3);
    expect(all.filter((point) => point.periodOn === "2026-09-01")).toEqual([
      expect.objectContaining({ value: "102", revision: 0 }),
      expect.objectContaining({ value: "103", revision: 1 }),
    ]);

    latest = 104;
    publishedRate = 9;
    await expect(
      recordArgentinaIndicator(expanded, dependencies),
    ).rejects.toMatchObject({
      code: "reconciliation_failed",
      detail: "published_mismatch",
    });
    expect(await repository.allObservations(expanded.id)).toEqual(all);
  });

  it("persists a salary null as missing while publishing reconciled levels", async () => {
    const early = {
      ...INDEC_WAGES_LEVEL_ROWS[0],
      periodo: "201510",
      anio: 2015,
      mes: 10,
      valor: null,
      valor_null: "///",
    };
    const rate = {
      ...INDEC_WAGES_LEVEL_ROWS[1],
      tipo_de_indicador: "v_m",
      tipo_de_indicador_descripcion:
        "Variación porcentual respecto del período anterior",
      unidad_de_medida: "Porcentaje",
      valor: 2,
    };
    const bodies = [
      JSON.stringify([early, ...INDEC_WAGES_LEVEL_ROWS]),
      JSON.stringify([rate]),
    ];
    let requests = 0;
    const fetch: EgressFetch = async () => {
      const body = new TextEncoder().encode(bodies[requests++]!);
      return {
        status: 200,
        body,
        byteLength: body.byteLength,
        fetchedAt: "2026-11-06T15:00:00.000Z",
      };
    };
    const repository = createPostgresArgentinaIndicatorRepository(database);
    const result = await recordArgentinaIndicator(wages, {
      sources: [
        createLiveIndecSource({
          sourceRegistry:
            createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY),
          fetch,
        }),
      ],
      repository,
      ingestionRuns: createPostgresIngestionRunRepository(database),
      now: () => "2026-11-06T15:01:00.000Z",
      newId: () => randomUUID(),
    });
    expect(result.runStatus).toBe("succeeded");
    expect(result.fetched.reconciliation?.status).toBe("matched");
    const all = await repository.allObservations(wages.id);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      periodOn: "2015-10-01",
      value: null,
      missingReason: "source_null",
      sourceNote: "///",
    });
    expect(all.at(-1)).toMatchObject({
      periodOn: "2026-08-01",
      value: "102",
    });
  });

  it("stores and replays the 28 declared expanded definitions without collisions", async () => {
    const indicators = DECLARED_INDEC_EXPANDED_INDICATORS;
    expect(indicators).toHaveLength(28);
    let clock = Date.parse("2026-11-06T15:00:00.000Z");
    const now = () => new Date((clock += 1000)).toISOString();
    const source: ArgentinaIndicatorSource = {
      sourceId: "indec-api",
      datasetId: "indec.service-rows",
      parserVersion: "indec-api-1.2.0",
      async load() {
        return {
          points: [
            { periodOn: "2026-07-01", value: "100", note: null },
            { periodOn: "2026-08-01", value: "102", note: null },
          ],
          observedAt: now(),
          requests: 0,
          bytes: 0,
        };
      },
    };
    const repository = createPostgresArgentinaIndicatorRepository(database);
    const dependencies = {
      sources: [source],
      repository,
      ingestionRuns: createPostgresIngestionRunRepository(database),
      now,
      newId: () => randomUUID(),
    };
    for (const item of indicators) {
      const first = await recordArgentinaIndicator(item, dependencies);
      expect(first.runStatus).toBe("succeeded");
      const replay = await recordArgentinaIndicator(item, dependencies);
      expect(replay.runStatus).toBe("duplicate");
    }
    const all = await repository.allObservationsOf(
      indicators.map((item) => item.id),
    );
    expect(all.size).toBe(28);
    for (const item of indicators) {
      const stored = all.get(item.id)!;
      expect(stored).toHaveLength(2);
      expect(
        readIndicatorVintages(item, stored, {
          effectiveOn: "2026-08-01",
          knownAt: "2026-11-06T15:10:00.000Z",
          knowledgeBasis: "system_recorded",
        }).at(-1),
      ).toMatchObject({ value: "102", revision: 0 });
    }
  });
});
