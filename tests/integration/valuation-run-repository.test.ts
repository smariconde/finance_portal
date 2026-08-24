import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEMO_IDENTITY_IDS } from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { runValuation } from "@/modules/valuation/application/run-valuation";
import { toReplayKey } from "@/modules/valuation/application/valuation-run-repository";
import {
  DEMO_VALUATION_INPUT,
  DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
} from "@/modules/valuation/infrastructure/demo-valuation-fixtures";
import { createPostgresValuationRunRepository } from "@/server/db/postgres-valuation-run-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const RUN_CLOCK = "2026-08-24T10:00:00.000Z";
const LATER_CLOCK = "2026-09-01T09:00:00.000Z";

const LEGAL_ENTITY_ID = DEMO_IDENTITY_IDS.fixtureCoEntity;

type PostgresErrorShape = { code?: string; constraint_name?: string };

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ??
      error) as PostgresErrorShape;
    expect(cause.constraint_name).toBe(constraintName);
    return;
  }

  throw new Error(`Expected ${constraintName} to reject the statement.`);
}

function valuation(
  input = DEMO_VALUATION_INPUT,
  options: { runId?: string; now?: string } = {},
) {
  return runValuation(input, {
    now: () => options.now ?? RUN_CLOCK,
    newValuationRunId: () => options.runId ?? randomUUID(),
  });
}

describe("PostgreSQL valuation runs", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });

    await database
      .delete(schema.valuationRuns)
      .where(eq(schema.valuationRuns.legalEntityId, LEGAL_ENTITY_ID));
  });

  afterAll(async () => {
    if (database) {
      await database
        .delete(schema.valuationRuns)
        .where(eq(schema.valuationRuns.legalEntityId, LEGAL_ENTITY_ID));
    }
    if (client) {
      await client.end();
    }
  });

  it("round-trips the snapshot, the result and their exact decimals", async () => {
    const repository = createPostgresValuationRunRepository(database);
    const stored = await repository.record(valuation());

    expect(stored.status).toBe("computed");
    // El decimal vuelve exactamente como se calculó: sin float intermedio.
    expect(stored.result?.valuePerShare).toBe(
      "13.54613115387460161790309586190624",
    );
    expect(stored.result?.terminal.reinvestmentRate).toBe(
      "0.1666666666666666666666666666666667",
    );
    expect(stored.input.baseRevenue.value).toBe("96000000");
    expect(stored.decimalPolicy).toStrictEqual({
      precision: 34,
      rounding: "ROUND_HALF_EVEN",
    });
  });

  it("treats an exact replay as the same run instead of a new row", async () => {
    const repository = createPostgresValuationRunRepository(database);
    const first = await repository.findByReplayKey(toReplayKey(valuation()));
    const replay = await repository.record(
      valuation(DEMO_VALUATION_INPUT, { now: LATER_CLOCK }),
    );

    expect(first).not.toBeNull();
    expect(replay.valuationRunId).toBe(first!.valuationRunId);
    expect(replay.recordedAt).toBe(first!.recordedAt);
    expect(
      await repository.list({ legalEntityId: LEGAL_ENTITY_ID }),
    ).toHaveLength(1);
  });

  it("keeps a different knowledge cutoff as its own run", async () => {
    const repository = createPostgresValuationRunRepository(database);

    await repository.record(valuation(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT));

    const runs = await repository.list({ legalEntityId: LEGAL_ENTITY_ID });

    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.inputHash)).size).toBe(2);
    expect(
      runs.map((run) => run.provenance.knowledge.knownAt).sort(),
    ).toStrictEqual(
      ["2025-03-01T00:00:00.000Z", "2025-06-01T00:00:00.000Z"].sort(),
    );
  });

  it("persists a rejected run so the refusal stays explainable", async () => {
    const repository = createPostgresValuationRunRepository(database);
    const rejected = await repository.record(
      valuation({ ...DEMO_VALUATION_INPUT, assetProfile: "bank" }),
    );

    expect(rejected).toMatchObject({
      status: "rejected",
      result: null,
      resultHash: null,
      failure: { code: "unsupported_method", subjects: ["assetProfile"] },
    });
    // El snapshot rechazado también queda: explica qué se intentó valuar.
    expect(rejected.input.assetProfile).toBe("bank");
  });

  it("refuses a rejected run that still carries a result", async () => {
    const [current] = await createPostgresValuationRunRepository(database).list(
      { legalEntityId: LEGAL_ENTITY_ID, limit: 1 },
    );

    await expectConstraintViolation(
      () =>
        database.insert(schema.valuationRuns).values({
          valuationRunId: randomUUID(),
          legalEntityId: LEGAL_ENTITY_ID,
          securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
          listingId: null,
          depositaryProgramId: null,
          asOf: "2025-06-30",
          currency: "USD",
          assetProfile: "non_financial_mature",
          method: "fcff_base",
          engineVersion: "fcff-1.0.0",
          methodologyVersion: "0.1.0",
          decimalPrecision: 34,
          decimalRounding: "ROUND_HALF_EVEN",
          status: "rejected",
          inputHash: "a".repeat(64),
          resultHash: "b".repeat(64),
          input: current!.input as unknown as Record<string, unknown>,
          result: { valuePerShare: "1" },
          failureCode: "policy_check_failed",
          failureMessage: "constraint probe",
          startedAt: new Date(RUN_CLOCK),
          finishedAt: new Date(RUN_CLOCK),
          recordedAt: new Date(RUN_CLOCK),
        }),
      "valuation_runs_outcome_check",
    );
  });

  it("refuses a hash that is not a content hash", async () => {
    const [current] = await createPostgresValuationRunRepository(database).list(
      { legalEntityId: LEGAL_ENTITY_ID, limit: 1 },
    );

    await expectConstraintViolation(
      () =>
        database.insert(schema.valuationRuns).values({
          valuationRunId: randomUUID(),
          legalEntityId: LEGAL_ENTITY_ID,
          securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
          listingId: null,
          depositaryProgramId: null,
          asOf: "2025-06-30",
          currency: "USD",
          assetProfile: "non_financial_mature",
          method: "fcff_base",
          engineVersion: "fcff-1.0.0",
          methodologyVersion: "0.1.0",
          decimalPrecision: 34,
          decimalRounding: "ROUND_HALF_EVEN",
          status: "computed",
          inputHash: "not-a-content-hash",
          resultHash: "c".repeat(64),
          input: current!.input as unknown as Record<string, unknown>,
          result: { valuePerShare: "1" },
          startedAt: new Date(RUN_CLOCK),
          finishedAt: new Date(RUN_CLOCK),
          recordedAt: new Date(RUN_CLOCK),
        }),
      "valuation_runs_hash_check",
    );
  });

  it("refuses two runs for the same snapshot and engine", async () => {
    const [current] = await createPostgresValuationRunRepository(database).list(
      { legalEntityId: LEGAL_ENTITY_ID, limit: 1 },
    );

    await expectConstraintViolation(
      () =>
        database.insert(schema.valuationRuns).values({
          valuationRunId: randomUUID(),
          legalEntityId: LEGAL_ENTITY_ID,
          securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
          listingId: null,
          depositaryProgramId: null,
          asOf: "2025-06-30",
          currency: "USD",
          assetProfile: "non_financial_mature",
          method: "fcff_base",
          engineVersion: current!.engineVersion,
          methodologyVersion: current!.methodologyVersion,
          decimalPrecision: 34,
          decimalRounding: "ROUND_HALF_EVEN",
          status: "computed",
          inputHash: current!.inputHash,
          resultHash: "d".repeat(64),
          input: current!.input as unknown as Record<string, unknown>,
          result: { valuePerShare: "1" },
          startedAt: new Date(RUN_CLOCK),
          finishedAt: new Date(RUN_CLOCK),
          recordedAt: new Date(RUN_CLOCK),
        }),
      "valuation_runs_replay_uidx",
    );
  });

  it("does not open the network to compute, persist or replay a run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const repository = createPostgresValuationRunRepository(database);

      await repository.record(valuation());
      expect(
        await repository.findByReplayKey(toReplayKey(valuation())),
      ).not.toBeNull();
      expect(repository.storage).toBe("personal-postgres");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
