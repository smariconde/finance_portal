import { describe, expect, it } from "vitest";

import type { EvalAttempt } from "../domain/eval-scoring";
import { loadEvalCases } from "../infrastructure/load-eval-cases";

import { rejudgeAttempt } from "./rejudge-attempt";

const { cases } = loadEvalCases();
const nvidia = cases.find((c) => c.caseId === "mix/NVDA/baseline")!;

const recorded = (overrides: Partial<EvalAttempt>): EvalAttempt => ({
  variantId: "ai-model-ladder-1.0.0",
  caseId: nvidia.caseId,
  rung: 3,
  requestedModel: "fixture/a",
  respondedModel: "fixture/a",
  outcome: "policy_rejected",
  detail: "name_does_not_match",
  finishReason: "stop",
  output:
    nvidia.task === "mix"
      ? {
          ...nvidia.gold!.output,
          lines: nvidia.gold!.output.lines.map((line) =>
            line.label.startsWith("China")
              ? { ...line, basis: "name_match", definitionQuote: null }
              : line,
          ),
        }
      : null,
  countedNanoUsd: 1,
  promptTokens: 1,
  completionTokens: 1,
  latencyMs: 1,
  ...overrides,
});

describe("rejudgeAttempt", () => {
  it("applies the current policy to a recorded output", () => {
    // `1.1.0` rechazaba «China (including Hong Kong)» como nombre; `1.2.0` no.
    expect(rejudgeAttempt(nvidia, recorded({}))).toMatchObject({
      outcome: "accepted",
      detail: null,
    });
  });

  it("leaves an output that never reached the policy as it was", () => {
    const invalid = recorded({ outcome: "schema_invalid", output: null });

    expect(rejudgeAttempt(nvidia, invalid)).toBe(invalid);
  });
});
