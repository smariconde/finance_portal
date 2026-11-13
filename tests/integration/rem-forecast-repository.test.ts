import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FetchedRemRelease } from "@/modules/macro-series/application/live-bcra-rem-release";
import { createPostgresRemForecastRepository } from "@/server/db/postgres-rem-forecast-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;

async function clean() {
  await database.delete(schema.remInflationForecasts);
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, "bcra-rem-release"));
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2 });
  database = drizzle(sql, { schema });
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await sql.end({ timeout: 5 });
});

const release: FetchedRemRelease = {
  roundMonth: "2026-10",
  publishedOn: "2026-11-05",
  availableAt: "2026-11-06T03:00:00.000Z",
  recordedAt: "2026-11-12T16:00:00.000Z",
  pageUrl:
    "https://www.bcra.gob.ar/publicaciones/relevamiento-de-expectativas-de-mercado-rem-octubre-de-2026/",
  workbookUrl:
    "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx",
  forecasts: [
    { roundMonth: "2026-10", targetMonth: "2026-10", medianPercent: "1.8" },
    { roundMonth: "2026-10", targetMonth: "2026-11", medianPercent: "1.9" },
  ],
  requests: 2,
  bytes: 100,
};

describe("PostgreSQL REM forecasts", () => {
  it("atomically publishes, duplicates and revises at the observed time", async () => {
    const repository = createPostgresRemForecastRepository(database);
    expect(
      await repository.publish({
        release,
        runId: randomUUID(),
        startedAt: release.recordedAt,
      }),
    ).toEqual({ status: "succeeded", accepted: 2 });
    expect(
      await repository.publish({
        release,
        runId: randomUUID(),
        startedAt: release.recordedAt,
      }),
    ).toEqual({ status: "duplicate", accepted: 0 });
    const corrected = {
      ...release,
      recordedAt: "2026-11-13T16:00:00.000Z",
      forecasts: [
        release.forecasts[0]!,
        { ...release.forecasts[1]!, medianPercent: "2.1" },
      ],
    };
    expect(
      await repository.publish({
        release: corrected,
        runId: randomUUID(),
        startedAt: corrected.recordedAt,
      }),
    ).toEqual({ status: "succeeded", accepted: 1 });
    expect(
      await repository.asKnown({
        targetMonth: "2026-11",
        knownAt: "2026-11-06T02:59:59.000Z",
        knowledgeBasis: "public_availability",
      }),
    ).toEqual([]);
    expect(
      await repository.asKnown({
        targetMonth: "2026-11",
        knownAt: "2026-11-10T12:00:00.000Z",
        knowledgeBasis: "public_availability",
      }),
    ).toMatchObject([{ medianPercent: "1.9", revision: 0 }]);
    expect(
      await repository.asKnown({
        targetMonth: "2026-11",
        knownAt: "2026-11-10T12:00:00.000Z",
        knowledgeBasis: "system_recorded",
      }),
    ).toEqual([]);
    expect(
      await repository.asKnown({
        targetMonth: "2026-11",
        knownAt: "2026-11-12T23:00:00.000Z",
        knowledgeBasis: "public_availability",
      }),
    ).toMatchObject([{ medianPercent: "1.9", revision: 0 }]);
    expect(
      await repository.asKnown({
        targetMonth: "2026-11",
        knownAt: "2026-11-13T16:00:00.000Z",
        knowledgeBasis: "public_availability",
      }),
    ).toMatchObject([{ medianPercent: "2.1", revision: 1 }]);
    expect(
      await repository.latestRoundAsKnown({
        knownAt: "2026-11-10T12:00:00.000Z",
        knowledgeBasis: "system_recorded",
      }),
    ).toEqual([]);
    expect(
      await repository.latestRoundAsKnown({
        knownAt: "2026-11-12T23:00:00.000Z",
        knowledgeBasis: "system_recorded",
      }),
    ).toMatchObject([
      { targetMonth: "2026-10", medianPercent: "1.8" },
      { targetMonth: "2026-11", medianPercent: "1.9" },
    ]);
    expect(await repository.open("2026-10")).toHaveLength(2);
  });

  it("rolls back the run and rows when a correction loses a target", async () => {
    const repository = createPostgresRemForecastRepository(database);
    await repository.publish({
      release,
      runId: randomUUID(),
      startedAt: release.recordedAt,
    });
    await expect(
      repository.publish({
        release: {
          ...release,
          recordedAt: "2026-11-13T16:00:00.000Z",
          forecasts: [release.forecasts[0]!],
        },
        runId: randomUUID(),
        startedAt: "2026-11-13T16:00:00.000Z",
      }),
    ).rejects.toThrow("rem_target_set_changed");
    expect(
      await database
        .select()
        .from(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, "bcra-rem-release")),
    ).toHaveLength(1);
  });
});
