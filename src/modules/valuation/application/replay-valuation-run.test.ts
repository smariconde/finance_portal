import { describe, expect, it, vi } from "vitest";

import { DEMO_AI_VALUATION_INPUT } from "../infrastructure/demo-ai-valuation-fixtures";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";

import { replayValuationRun } from "./replay-valuation-run";
import { runValuation } from "./run-valuation";

const RUN_ID = "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c4b1";

function recordedRun(input = DEMO_AI_VALUATION_INPUT) {
  return runValuation(input, {
    now: () => "2026-10-16T12:00:00.000Z",
    newValuationRunId: () => RUN_ID,
  });
}

describe("replayValuationRun", () => {
  it("reproduces both hashes of a run with an AI industry and mix, without the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const repository = createInMemoryValuationRunRepository();
    const recorded = await repository.record(recordedRun());

    // Lo que vuelve de la base es JSON: el replay parte de esa forma.
    const stored = JSON.parse(
      JSON.stringify(await repository.findById(RUN_ID)),
    ) as typeof recorded;
    const replay = replayValuationRun(stored);
    if (stored.method !== "fcff_base")
      throw new Error("Expected FCFF fixture.");

    expect(replay).toEqual({
      version: "valuation-replay-1.0.0",
      valuationRunId: RUN_ID,
      outcome: "reproduced",
      divergences: [],
      recorded: {
        status: "computed",
        inputHash: recorded.inputHash,
        resultHash: recorded.resultHash,
      },
      replayed: {
        status: "computed",
        inputHash: recorded.inputHash,
        resultHash: recorded.resultHash,
      },
    });
    expect(stored.input.qualitativeDecisions.industry).toMatchObject({
      basis: "ai_resolution",
    });
    expect(stored.input.qualitativeDecisions.operationsMix).toMatchObject({
      source: "ai_proposal",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reproduces a rejected run as rejected", () => {
    const rejected = recordedRun({
      ...DEMO_AI_VALUATION_INPUT,
      qualitativeDecisions: {
        ...DEMO_AI_VALUATION_INPUT.qualitativeDecisions,
        operationsMix: null,
      },
    });

    expect(rejected.status).toBe("rejected");
    expect(replayValuationRun(rejected)).toMatchObject({
      outcome: "reproduced",
      replayed: { status: "rejected", resultHash: null },
    });
  });

  it("names a stored result that the snapshot no longer produces", () => {
    const recorded = recordedRun();
    const replay = replayValuationRun({
      ...recorded,
      resultHash: "0".repeat(64),
    });

    expect(replay).toMatchObject({
      outcome: "diverged",
      divergences: ["result_hash"],
    });
  });

  it("names a snapshot edited after it was hashed", () => {
    const recorded = recordedRun();
    const industry = recorded.input.qualitativeDecisions.industry!;

    if (industry.basis !== "ai_resolution") throw new Error("AI fixture");

    const replay = replayValuationRun({
      ...recorded,
      input: {
        ...recorded.input,
        qualitativeDecisions: {
          ...recorded.input.qualitativeDecisions,
          industry: {
            ...industry,
            resolution: {
              ...industry.resolution,
              respondedModel: "other/model",
            },
          },
        },
      },
    });

    expect(replay).toMatchObject({
      outcome: "diverged",
      divergences: ["input_hash", "result_hash"],
    });
  });

  it("names a status the snapshot no longer reaches", () => {
    const recorded = recordedRun();
    const lines = recorded.input.qualitativeDecisions.operationsMix;

    if (lines?.source !== "ai_proposal") throw new Error("AI fixture");

    const replay = replayValuationRun({
      ...recorded,
      input: {
        ...recorded.input,
        qualitativeDecisions: {
          ...recorded.input.qualitativeDecisions,
          operationsMix: {
            ...lines,
            lines: lines.lines.map((line, index) =>
              index === 0 ? { ...line, amount: "1" } : line,
            ),
          },
        },
      },
    });

    expect(replay.divergences).toEqual(["input_hash", "result_hash", "status"]);
    expect(replay.replayed.status).toBe("rejected");
  });
});
