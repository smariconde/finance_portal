import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  recordArgentinaIndicator,
  type ArgentinaIndicatorSource,
} from "@/modules/macro-series/application/record-argentina-indicator";
import { readIndicatorVintages } from "@/modules/macro-series/domain/argentina-indicator";
import { DECLARED_ARGENTINA_INDICATORS } from "@/modules/macro-series/domain/declared-argentina-indicators";
import { createPostgresArgentinaIndicatorRepository } from "@/server/db/postgres-argentina-indicator-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const indicator = DECLARED_ARGENTINA_INDICATORS[0]!;

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function clean() {
  await database.delete(schema.argentinaIndicatorObservations);
  await database.delete(schema.argentinaIndicatorDefinitions);
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, indicator.sourceId));
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
});
