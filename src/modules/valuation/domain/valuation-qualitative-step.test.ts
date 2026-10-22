import { describe, expect, it } from "vitest";

import {
  qualitativeStepAccepted,
  valuationQualitativeStepSchema,
  VALUATION_QUALITATIVE_RULE_VERSION,
} from "./valuation-qualitative-step";

const base = {
  ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
  industry: { status: "present" },
  employeeEquity: { status: "present" },
  operationsMix: { status: "present" },
  chargedNanoUsd: 0,
} as const;

describe("valuationQualitativeStepSchema", () => {
  it("records each task with its own status", () => {
    const step = valuationQualitativeStepSchema.parse({
      ...base,
      industry: { status: "accepted", rung: 1 },
      employeeEquity: { status: "abstained", reason: "ladder_exhausted" },
      operationsMix: { status: "not_run" },
      chargedNanoUsd: 2_600_000,
    });

    expect(step.industry).toEqual({ status: "accepted", rung: 1 });
  });

  it("refuses free text where a code goes", () => {
    expect(() =>
      valuationQualitativeStepSchema.parse({
        ...base,
        employeeEquity: { status: "failed", code: "SEC said 503 for /x" },
      }),
    ).toThrow();
  });

  it("refuses a negative charge", () => {
    expect(() =>
      valuationQualitativeStepSchema.parse({ ...base, chargedNanoUsd: -1 }),
    ).toThrow();
  });
});

describe("qualitativeStepAccepted", () => {
  it("is true only when some task left an accepted decision", () => {
    expect(
      qualitativeStepAccepted(valuationQualitativeStepSchema.parse(base)),
    ).toBe(false);
    expect(
      qualitativeStepAccepted(
        valuationQualitativeStepSchema.parse({
          ...base,
          industry: { status: "abstained", reason: "insufficient_evidence" },
          operationsMix: { status: "accepted", rung: 2 },
        }),
      ),
    ).toBe(true);
  });
});
