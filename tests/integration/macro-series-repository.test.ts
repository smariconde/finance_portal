import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createLiveBcraSource } from "@/modules/macro-series/application/live-bcra-source";
import { readMacroSeries } from "@/modules/macro-series/application/read-macro-series";
import { recordBcraCatalog } from "@/modules/macro-series/application/record-bcra-catalog";
import { recordBcraSeries } from "@/modules/macro-series/application/record-bcra-series";
import {
  materializeObservationPlan,
  planObservations,
} from "@/modules/macro-series/domain/series-observation";
import {
  createFixtureBcraFetch,
  fixtureDailyPoints,
  wireNumber,
  type FixtureBcraState,
} from "@/modules/macro-series/infrastructure/fixture-bcra-payloads";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresMacroSeriesRepository } from "@/server/db/postgres-macro-series-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const KEY = "bcra-monetarias-v4:30";

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function clean() {
  await database.delete(schema.macroSeriesObservations);
  await database.delete(schema.macroSeriesDefinitions);
  await database.delete(schema.macroSeries);
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, "bcra-monetarias-v4"));
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 4 });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  // Vecinos vacían `ingestion_runs`: una fila dejada atrás lo bloquearía.
  await clean();
  await sql.end({ timeout: 5 });
});

beforeEach(clean);

function query(at: string, effectiveAt = "2026-12-31T00:00:00.000Z") {
  return {
    effectiveAt,
    knownAt: at,
    revisionPolicy: "as_known" as const,
    knowledgeBasis: "public_availability" as const,
    adjustmentPolicy: "as_known" as const,
    sourcePolicyVersion: "source-policy-1.0.0",
  };
}

function setup() {
  const state: FixtureBcraState = {
    catalog: [
      {
        idVariable: 30,
        tipoSerie: "Índice",
        unidadExpresion: "Índice base 2.2.02=1",
      },
    ],
    methodology: [{ id: 30, detalle: "Coeficiente sintético." }],
    series: new Map([[30, fixtureDailyPoints("2026-11-15", 3500)]]),
  };
  let tick = Date.parse("2026-11-02T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const fetch = createFixtureBcraFetch(state, clock);
  const repository = createPostgresMacroSeriesRepository(database);
  const dependencies = {
    source: createLiveBcraSource({
      sourceRegistry: createInMemorySourceRegistryRepository(),
      fetch,
    }),
    repository,
    ingestionRuns: createPostgresIngestionRunRepository(database),
    now: clock,
    newId: () => randomUUID(),
  };

  return { state, repository, dependencies, fetch };
}

describe("macro series on PostgreSQL", () => {
  it("records the catalog once and the history in revision 0, with the basis pinned", async () => {
    const { repository, dependencies } = setup();
    const catalog = await recordBcraCatalog(dependencies);
    const again = await recordBcraCatalog(dependencies);
    const series = await recordBcraSeries(30, dependencies);

    expect(catalog.runStatus).toBe("succeeded");
    expect(again.runStatus).toBe("duplicate");
    expect(series.status === "recorded" && series.runStatus).toBe("succeeded");
    expect(await repository.findSeries(KEY)).toMatchObject({
      basis: {
        frequency: "daily",
        unit: "Índice base 2.2.02=1",
        currencyCode: "ML",
      },
    });
    expect(await repository.listOpenObservations(KEY, null)).toHaveLength(3500);
    expect(
      (await repository.listOpenObservations(KEY, "2026-11-10")).map(
        (observation) => observation.periodOn,
      ),
    ).toEqual([
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("revises and withdraws inside the window and keeps each value readable at its cutoff", async () => {
    const { state, repository, dependencies } = setup();
    await recordBcraCatalog(dependencies);
    const first = await recordBcraSeries(30, dependencies);
    const firstSeen =
      first.status === "recorded" ? first.fetched.observedAt : "";
    const points = [...state.series.get(30)!];
    const revisedDate = points[1]!.fecha;
    const withdrawnDate = points[2]!.fecha;
    points[1] = { ...points[1]!, valor: wireNumber("123456789.12345678901") };
    points.splice(2, 1);
    state.series.set(30, points);

    const refresh = await recordBcraSeries(30, dependencies);
    const seen =
      refresh.status === "recorded" ? refresh.fetched.observedAt : "";

    expect(refresh.status === "recorded" && refresh.plan.counts).toMatchObject({
      revised: 1,
      withdrawn: 1,
    });

    const before = await readMacroSeries(KEY, query(firstSeen), repository);
    const after = await readMacroSeries(KEY, query(seen), repository);
    const value = (reading: typeof before, date: string) =>
      reading.status === "read"
        ? reading.points.find((point) => point.periodOn === date)?.value
        : "no reading";

    expect(value(before, revisedDate)).not.toBe("123456789.12345678901");
    expect(value(after, revisedDate)).toBe("123456789.12345678901");
    expect(value(before, withdrawnDate)).toBeDefined();
    expect(value(after, withdrawnDate)).toBeUndefined();
    expect(after.status === "read" && after.withdrawn).toBe(1);
    expect(
      await readMacroSeries(KEY, query("2026-11-01T00:00:00.000Z"), repository),
    ).toEqual({ status: "no_definition_at_cutoff" });
  });

  it("aborts a stale plan whole when another write got there first", async () => {
    const { state, repository, dependencies } = setup();
    await recordBcraCatalog(dependencies);
    await recordBcraSeries(30, dependencies);
    const open = await repository.listOpenObservations(KEY, "2026-11-01");
    const run = (await recordBcraSeries(30, dependencies)) as Extract<
      Awaited<ReturnType<typeof recordBcraSeries>>,
      { status: "recorded" }
    >;
    const stalePlan = planObservations({
      seriesKey: KEY,
      points: [
        { periodOn: "2026-11-15", value: "1" },
        { periodOn: "2026-11-14", value: "2" },
      ],
      rejections: [],
      coverage: "window",
      open: open.filter((observation) => observation.periodOn >= "2026-11-14"),
      acceptMassChange: false,
    });
    const points = [...state.series.get(30)!];
    points[0] = { ...points[0]!, valor: wireNumber("7") };
    state.series.set(30, points);
    await recordBcraSeries(30, dependencies);

    await expect(
      repository.applyObservations({
        seriesKey: KEY,
        basis: {
          frequency: "daily",
          unit: "Índice base 2.2.02=1",
          currencyCode: "ML",
        },
        revisions: materializeObservationPlan(stalePlan, {
          observedAt: "2026-11-03T00:00:00.000Z",
          recordedAt: "2026-11-03T00:00:00.000Z",
          ingestionRunId: run.runId!,
        }),
      }),
    ).rejects.toThrow();

    const latest = await repository.listOpenObservations(KEY, "2026-11-14");

    expect(
      latest.map((observation) => [observation.periodOn, observation.value]),
    ).toEqual([
      ["2026-11-14", open.find((o) => o.periodOn === "2026-11-14")!.value],
      ["2026-11-15", "7"],
    ]);
  });

  it("refuses to write on a series pinned to another basis", async () => {
    const { repository, dependencies } = setup();
    await recordBcraCatalog(dependencies);
    const first = await recordBcraSeries(30, dependencies);

    await expect(
      repository.applyObservations({
        seriesKey: KEY,
        basis: {
          frequency: "daily",
          unit: "Índice base 2016=100",
          currencyCode: "ML",
        },
        revisions: [
          {
            seriesKey: KEY,
            periodOn: "2026-11-16",
            revision: 0,
            value: "1",
            withdrawn: false,
            availableAt: "2026-11-03T00:00:00.000Z",
            supersededAt: null,
            recordedAt: "2026-11-03T00:00:00.000Z",
            ingestionRunId: first.status === "recorded" ? first.runId! : "",
          },
        ],
      }),
    ).rejects.toThrow(/another basis/u);
  });

  it("mirrors the withdrawn invariant in a check constraint", async () => {
    const { dependencies } = setup();
    await recordBcraCatalog(dependencies);
    const first = await recordBcraSeries(30, dependencies);
    const [series] = await database.select().from(schema.macroSeries);

    await expect(
      database.insert(schema.macroSeriesObservations).values({
        seriesId: series!.seriesId,
        periodOn: "2030-01-01",
        revision: 0,
        value: null,
        withdrawn: false,
        availableAt: new Date("2026-11-03T00:00:00.000Z"),
        ingestionRunId:
          first.status === "recorded" ? first.runId! : randomUUID(),
      }),
    ).rejects.toThrow();
  });
});
