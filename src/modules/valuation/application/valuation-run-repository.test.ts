import { describe, expect, it, vi } from "vitest";

import { isRuntimeLockedError } from "@/modules/configuration/domain/runtime-lock";

import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import {
  DEMO_VALUATION_INPUT,
  DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
} from "../infrastructure/demo-valuation-fixtures";
import { runValuation } from "./run-valuation";
import {
  createValuationCacheIdentity,
  selectValuationRunRepository,
  toReplayKey,
} from "./valuation-run-repository";

const dependencies = (runId: string, now = "2026-08-24T12:00:00.000Z") => ({
  now: () => now,
  newValuationRunId: () => runId,
});

const RUN_A = "11111111-2222-4333-8444-555555555555";
const RUN_B = "99999999-8888-4777-8666-555555555555";

describe("valuation run repository contract", () => {
  it("keeps a rerun of the same snapshot as one append-only run", async () => {
    const repository = createInMemoryValuationRunRepository();
    const first = await repository.record(
      runValuation(DEMO_VALUATION_INPUT, dependencies(RUN_A)),
    );
    const replay = await repository.record(
      runValuation(
        DEMO_VALUATION_INPUT,
        dependencies(RUN_B, "2026-09-01T09:00:00.000Z"),
      ),
    );

    // El replay devuelve la corrida original: no la sobrescribe ni la duplica.
    expect(replay.valuationRunId).toBe(first.valuationRunId);
    expect(replay.recordedAt).toBe(first.recordedAt);
    expect(
      await repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
      }),
    ).toHaveLength(1);
  });

  it("treats another knowledge cutoff as another run", async () => {
    const repository = createInMemoryValuationRunRepository();

    await repository.record(
      runValuation(DEMO_VALUATION_INPUT, dependencies(RUN_A)),
    );
    await repository.record(
      runValuation(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT, dependencies(RUN_B)),
    );

    expect(
      await repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
      }),
    ).toHaveLength(2);
  });

  it("finds a run by its replay key", async () => {
    const repository = createInMemoryValuationRunRepository();
    const stored = await repository.record(
      runValuation(DEMO_VALUATION_INPUT, dependencies(RUN_A)),
    );

    expect(await repository.findByReplayKey(toReplayKey(stored))).toMatchObject(
      { valuationRunId: RUN_A },
    );
    expect(
      await repository.findByReplayKey({
        inputHash: "a".repeat(64),
        engineVersion: stored.engineVersion,
        methodologyVersion: stored.methodologyVersion,
      }),
    ).toBeNull();
  });

  it("records a rejected run as well", async () => {
    const repository = createInMemoryValuationRunRepository();
    const rejected = await repository.record(
      runValuation(
        {
          ...DEMO_VALUATION_INPUT,
          assetProfile: "bank",
        },
        dependencies(RUN_A),
      ),
    );

    expect(rejected.status).toBe("rejected");
    expect(
      await repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
      }),
    ).toHaveLength(1);
  });

  it("bounds a listing and filters by security", async () => {
    const repository = createInMemoryValuationRunRepository();

    await repository.record(
      runValuation(DEMO_VALUATION_INPUT, dependencies(RUN_A)),
    );

    expect(
      await repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
        securityId: DEMO_VALUATION_INPUT.subject.securityId,
      }),
    ).toHaveLength(1);
    expect(
      await repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
        securityId: "0a1b7c40-3f21-4d8e-9a01-000000000013",
      }),
    ).toHaveLength(0);
    await expect(
      repository.list({
        legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
        limit: 5000,
      }),
    ).rejects.toThrowError();
  });

  it("selects the repository in composition, never from a request", () => {
    const personal = createInMemoryValuationRunRepository();

    expect(
      selectValuationRunRepository("personal", { personal: () => personal }),
    ).toBe(personal);
  });

  it("refuses to build a repository while the runtime is locked", () => {
    const personal = vi.fn(createInMemoryValuationRunRepository);

    try {
      selectValuationRunRepository("locked", { personal });
      throw new Error("Expected a locked runtime rejection.");
    } catch (error) {
      expect(isRuntimeLockedError(error)).toBe(true);
    }

    expect(personal).not.toHaveBeenCalled();
  });

  it("namespaces the cache identity by effective mode", () => {
    const inputHash = "b".repeat(64);

    expect(createValuationCacheIdentity("locked", inputHash)).toStrictEqual([
      "valuation",
      "locked",
      "fcff-1.0.0",
      inputHash,
    ]);
    expect(
      createValuationCacheIdentity("personal", inputHash),
    ).not.toStrictEqual(createValuationCacheIdentity("locked", inputHash));
  });
});
