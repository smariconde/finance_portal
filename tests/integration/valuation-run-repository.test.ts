import { fixtureGrowthValuation } from "@/modules/valuation/infrastructure/fixture-growth-valuation";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEMO_IDENTITY_IDS } from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { replayValuationRun } from "@/modules/valuation/application/replay-valuation-run";
import { runValuation } from "@/modules/valuation/application/run-valuation";
import { runExcessReturn } from "@/modules/valuation/application/run-excess-return";
import { fixtureFinancialValuation } from "@/modules/valuation/infrastructure/fixture-financial-valuation";
import { fixtureCycleValuation } from "@/modules/valuation/infrastructure/fixture-cycle-valuation";
import { toReplayKey } from "@/modules/valuation/application/valuation-run-repository";
import { DEMO_AI_VALUATION_INPUT } from "@/modules/valuation/infrastructure/demo-ai-valuation-fixtures";
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
    if (stored.method !== "fcff_base")
      throw new Error("Expected FCFF fixture.");

    expect(stored.status).toBe("computed");
    // El decimal vuelve exactamente como se calculó: sin float intermedio.
    expect(stored.result?.valuePerShare).toBe(
      "13.38595823089633093010436561532236",
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

  it("reads a run with an AI industry and mix back by ID and replays both hashes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const repository = createPostgresValuationRunRepository(database);
      const runId = randomUUID();
      const recorded = await repository.record(
        valuation(DEMO_AI_VALUATION_INPUT, { runId }),
      );
      const stored = await repository.findById(runId);
      if (stored?.method !== "fcff_base")
        throw new Error("Expected stored FCFF run.");

      expect(recorded.valuationRunId).toBe(runId);
      expect(stored?.input.qualitativeDecisions).toStrictEqual(
        DEMO_AI_VALUATION_INPUT.qualitativeDecisions,
      );
      // JSONB reordena claves: el hash canónico no depende de ese orden.
      expect(replayValuationRun(stored!)).toMatchObject({
        outcome: "reproduced",
        replayed: {
          inputHash: recorded.inputHash,
          resultHash: recorded.resultHash,
        },
      });
      expect(await repository.findById(randomUUID())).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("round-trips financial equity, preserves its decimals and deduplicates its own replay key", async () => {
    const repository = createPostgresValuationRunRepository(database);
    const computed = runExcessReturn(fixtureFinancialValuation(), {
      now: () => RUN_CLOCK,
      newValuationRunId: randomUUID,
    });
    const stored = await repository.record(computed);
    if (stored.method !== "excess_return")
      throw new Error("Expected excess-return run.");
    expect(stored).toEqual(computed);
    expect(stored.result!.base.equityValue).toBe(
      computed.result!.base.equityValue,
    );
    const duplicate = await repository.record({
      ...computed,
      valuationRunId: randomUUID(),
      recordedAt: LATER_CLOCK,
    });
    expect(duplicate.valuationRunId).toBe(stored.valuationRunId);
    const read = await repository.findById(stored.valuationRunId);
    expect(replayValuationRun(read!)).toMatchObject({
      outcome: "reproduced",
      divergences: [],
    });
    expect(await repository.findByReplayKey(toReplayKey(computed))).toEqual(
      stored,
    );
  });

  it("persists financial refusals alongside FCFF without fabricating a result", async () => {
    const input = fixtureFinancialValuation();
    input.commonBookEquity = null;
    const refused = runExcessReturn(input, {
      now: () => RUN_CLOCK,
      newValuationRunId: randomUUID,
    });
    const repository = createPostgresValuationRunRepository(database);
    const stored = await repository.record(refused);
    expect(stored).toMatchObject({
      method: "excess_return",
      status: "rejected",
      result: null,
      resultHash: null,
    });
    expect(replayValuationRun(stored).outcome).toBe("reproduced");
    const methods = (
      await repository.list({ legalEntityId: LEGAL_ENTITY_ID })
    ).map((run) => run.method);
    expect(methods).toContain("excess_return");
    expect(methods).toContain("fcff_base");
  });

  it("round-trips normalized FCFF, deduplicates it and replays its frozen cycle without network", async () => {
    const repository = createPostgresValuationRunRepository(database);
    const computed = valuation(fixtureCycleValuation());
    const stored = await repository.record(computed);
    expect(stored).toEqual(computed);
    expect(stored.status).toBe("requires_review");
    expect(
      (await repository.record(valuation(fixtureCycleValuation())))
        .valuationRunId,
    ).toBe(stored.valuationRunId);
    expect(
      replayValuationRun((await repository.findById(stored.valuationRunId))!)
        .outcome,
    ).toBe("reproduced");
    expect(await repository.findByReplayKey(toReplayKey(stored))).toEqual(
      stored,
    );
  });

  it("preserves a cycle refusal and all three method families side by side", async () => {
    const input = fixtureCycleValuation();
    input.cycleNormalization!.history[0]!.ebit = null;
    const repository = createPostgresValuationRunRepository(database);
    const stored = await repository.record(valuation(input));
    expect(stored).toMatchObject({
      status: "rejected",
      method: "normalized_fcff",
      result: null,
    });
    expect(replayValuationRun(stored).outcome).toBe("reproduced");
    const methods = (
      await repository.list({ legalEntityId: LEGAL_ENTITY_ID })
    ).map((run) => run.method);
    expect(new Set(methods)).toEqual(
      new Set(["fcff_base", "excess_return", "normalized_fcff"]),
    );
  });
  it.each(["loss_making", "high_growth"] as const)(
    "round-trips %s with loss taxes, dedupe and offline replay",
    async (profile) => {
      const repository = createPostgresValuationRunRepository(database);
      const input = fixtureGrowthValuation(profile);
      const computed = valuation(input);
      const stored = await repository.record(computed);
      expect(stored).toEqual(computed);
      expect(stored.status).toBe("requires_review");
      expect((await repository.record(valuation(input))).valuationRunId).toBe(
        stored.valuationRunId,
      );
      expect(await repository.findByReplayKey(toReplayKey(stored))).toEqual(
        stored,
      );
      expect(
        replayValuationRun((await repository.findById(stored.valuationRunId))!)
          .outcome,
      ).toBe("reproduced");
      input.revenueMargin!.lossCarryforward = null;
      const refused = await repository.record(valuation(input));
      expect(refused.status).toBe("rejected");
      expect(replayValuationRun(refused).outcome).toBe("reproduced");
    },
  );
});
