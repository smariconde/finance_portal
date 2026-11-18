import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CONSENSUS_DATASET_ID } from "@/modules/consensus/application/consensus-repository";
import {
  consensusAt,
  planConsensusRevisions,
  valuesOf,
} from "@/modules/consensus/domain/consensus-revisions";
import type { FiscalYearEstimate } from "@/modules/consensus/domain/earnings-estimates-parser";
import { createPostgresConsensusRepository } from "@/server/db/postgres-consensus-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let sql: Sql;
let database: PostgresJsDatabase<typeof schema>;
let securityId: string;
let legalEntityId: string;

function estimate(periodEnd: string, epsAverage: string): FiscalYearEstimate {
  return {
    periodEnd,
    epsAverage,
    epsHigh: null,
    epsLow: null,
    epsAnalystCount: 12,
    epsAverage7DaysAgo: "4.9",
    epsAverage30DaysAgo: null,
    epsAverage60DaysAgo: null,
    epsAverage90DaysAgo: "4.5",
    epsRevisionsUp7Days: 0,
    epsRevisionsDown7Days: null,
    epsRevisionsUp30Days: 3,
    epsRevisionsDown30Days: null,
    revenueAverage: "123456789012.5",
    revenueHigh: null,
    revenueLow: null,
    revenueAnalystCount: 10,
  };
}

async function run(
  status: "succeeded" | "duplicate",
  finishedAt: string,
): Promise<string> {
  const runId = randomUUID();
  const key = randomUUID().replace(/-/gu, "").padEnd(64, "0");
  await database.insert(schema.ingestionRuns).values({
    runId,
    sourceId: "alpha-vantage",
    datasetId: CONSENSUS_DATASET_ID,
    parserVersion: "av-earnings-estimates-1.0.0",
    idempotencyKey: key,
    subjectKey: securityId,
    status,
    startedAt: new Date(finishedAt),
    finishedAt: new Date(finishedAt),
    fetchedCount: 2,
    acceptedCount: status === "succeeded" ? 2 : 0,
    rejectedCount: 0,
    duplicateCount: status === "succeeded" ? 0 : 2,
    contentHash: key,
    recordedAt: new Date(finishedAt),
  });
  return runId;
}

async function cleanUp(): Promise<void> {
  await database.delete(schema.consensusEstimates);
  await database.delete(schema.ownerMultipleThresholds);
}

beforeAll(() => {
  sql = postgres(databaseTestUrl, { max: 2, onnotice: () => {} });
  database = drizzle(sql, { schema });
});

afterAll(async () => {
  // The universe suite empties the identity tables unfiltered: nothing of
  // this one may keep a reference to a security or a legal entity.
  await cleanUp();
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.datasetId, CONSENSUS_DATASET_ID));
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await cleanUp();
  securityId = randomUUID();
  legalEntityId = randomUUID();
  await database.insert(schema.securities).values({ securityId });
  await database.insert(schema.legalEntities).values({ legalEntityId });
});

describe("consensus estimates on PostgreSQL (ADR 0083)", () => {
  it("keeps revision chains, reads them at a cutoff and dates captures by run", async () => {
    const repository = createPostgresConsensusRepository(database);
    const first = await run("succeeded", "2026-11-18T15:00:00.000Z");
    const plan = planConsensusRevisions({
      securityId,
      open: [],
      fetched: [estimate("2026-12-31", "5"), estimate("2027-12-31", "6")],
      observedAt: "2026-11-18T15:00:00.000Z",
    });
    await repository.apply(plan, first);
    await run("duplicate", "2026-11-19T15:00:00.000Z");

    const open = await repository.loadOpen(securityId);
    expect(open.map((row) => row.values)).toEqual([
      valuesOf(estimate("2026-12-31", "5")),
      valuesOf(estimate("2027-12-31", "6")),
    ]);

    const second = await run("succeeded", "2027-02-01T15:00:00.000Z");
    await repository.apply(
      planConsensusRevisions({
        securityId,
        open,
        fetched: [estimate("2027-12-31", "6.25")],
        observedAt: "2027-02-01T15:00:00.000Z",
      }),
      second,
    );

    const revisions = await repository.loadRevisions(securityId);
    expect(revisions.map((row) => [row.periodEnd, row.revision])).toEqual([
      ["2026-12-31", 0],
      ["2026-12-31", 1],
      ["2027-12-31", 0],
      ["2027-12-31", 1],
    ]);
    expect(
      consensusAt(revisions, "2027-01-31T00:00:00.000Z").map((row) => [
        row.periodEnd,
        row.values.epsAverage,
      ]),
    ).toEqual([
      ["2026-12-31", "5"],
      ["2027-12-31", "6"],
    ]);
    expect(
      consensusAt(revisions, "2027-02-01T15:00:00.000Z").map((row) => [
        row.periodEnd,
        row.values.epsAverage,
      ]),
    ).toEqual([["2027-12-31", "6.25"]]);
    expect(await repository.captures(securityId)).toEqual([
      "2026-11-18T15:00:00.000Z",
      "2026-11-19T15:00:00.000Z",
      "2027-02-01T15:00:00.000Z",
    ]);
  });

  it("refuses a second open revision and a withdrawal that keeps numbers", async () => {
    const repository = createPostgresConsensusRepository(database);
    const runId = await run("succeeded", "2026-11-18T15:00:00.000Z");
    const plan = planConsensusRevisions({
      securityId,
      open: [],
      fetched: [estimate("2026-12-31", "5")],
      observedAt: "2026-11-18T15:00:00.000Z",
    });
    await repository.apply(plan, runId);
    await expect(repository.apply(plan, runId)).rejects.toThrow();

    await expect(
      database.insert(schema.consensusEstimates).values({
        securityId,
        periodEnd: "2027-12-31",
        revision: 0,
        withdrawn: true,
        epsAverage: null,
        epsAnalystCount: 3,
        availableAt: new Date("2026-11-18T15:00:00.000Z"),
        ingestionRunId: runId,
      }),
    ).rejects.toThrow();
  });

  it("keeps the owner's threshold declarations in order", async () => {
    const repository = createPostgresConsensusRepository(database);
    await repository.declareThreshold({
      thresholdId: randomUUID(),
      legalEntityId,
      metric: "forward_pe",
      value: "12",
      reason: "FANG barata",
      declaredAt: "2026-11-18T15:00:00.000Z",
    });
    await repository.declareThreshold({
      thresholdId: randomUUID(),
      legalEntityId,
      metric: "forward_pe",
      value: null,
      reason: null,
      declaredAt: "2026-11-19T15:00:00.000Z",
    });
    expect(
      (await repository.loadThresholds(legalEntityId, "forward_pe")).map(
        (row) => row.value,
      ),
    ).toEqual(["12", null]);
    await expect(
      repository.declareThreshold({
        thresholdId: randomUUID(),
        legalEntityId,
        metric: "forward_pe",
        value: "0",
        reason: null,
        declaredAt: "2026-11-20T15:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
