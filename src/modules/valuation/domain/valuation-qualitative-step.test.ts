import { describe, expect, it } from "vitest";

import {
  asksQualitativeDecisions,
  awaitsCycleHistory,
  awaitsGrowthInputs,
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

describe("asksQualitativeDecisions", () => {
  const selection = (
    overrides: Partial<Parameters<typeof asksQualitativeDecisions>[0]>,
  ): Parameters<typeof asksQualitativeDecisions>[0] => ({
    status: "selected",
    assetProfile: "non_financial_mature",
    recommendedMethod: "fcff_base",
    requiredInputs: ["fcff_inputs"],
    unsupportedReasons: [],
    ...overrides,
  });

  it("asks for a selected FCFF method", () => {
    expect(asksQualitativeDecisions(selection({}))).toBe(true);
  });

  it("asks for a cyclical that only awaits its cycle history", () => {
    const cyclical = selection({
      status: "unsupported_method",
      assetProfile: "cyclical",
      recommendedMethod: "normalized_fcff",
      requiredInputs: ["cycle_margins"],
      unsupportedReasons: ["missing_required_input"],
    });

    expect(awaitsCycleHistory(cyclical)).toBe(true);
    expect(asksQualitativeDecisions(cyclical)).toBe(true);
  });

  it("asks for a bank before its excess-return inputs are complete", () => {
    expect(
      asksQualitativeDecisions(
        selection({
          status: "unsupported_method",
          assetProfile: "bank",
          recommendedMethod: "excess_return",
          requiredInputs: ["book_equity", "roe", "cost_of_equity"],
          unsupportedReasons: ["missing_required_input"],
        }),
      ),
    ).toBe(true);
  });

  // PLTR, DDOG y RDDT, 2026-11-18: SIC ambiguo, sin costo de capital, y la
  // trayectoria lo necesita; sin preguntar la industria no había camino.
  it.each(["fcff_three_stage", "revenue_margin_survival"])(
    "asks for %s when it only lacks inputs",
    (method) => {
      const growth = selection({
        status: "unsupported_method",
        assetProfile: "high_growth",
        recommendedMethod: method,
        requiredInputs: ["revenue_growth", "target_margin"],
        unsupportedReasons: ["missing_required_input"],
      });

      expect(awaitsGrowthInputs(growth)).toBe(true);
      expect(asksQualitativeDecisions(growth)).toBe(true);
    },
  );

  it("does not spend on a growth method refused for another reason", () => {
    expect(
      asksQualitativeDecisions(
        selection({
          status: "unsupported_method",
          assetProfile: "high_growth",
          recommendedMethod: "fcff_three_stage",
          unsupportedReasons: [
            "missing_required_input",
            "method_not_implemented",
          ],
        }),
      ),
    ).toBe(false);
  });

  it("does not ask for an unimplemented method such as distress", () => {
    expect(
      asksQualitativeDecisions(
        selection({
          status: "unsupported_method",
          assetProfile: "distressed",
          recommendedMethod: "apv_scenarios",
          requiredInputs: ["failure_scenarios"],
          unsupportedReasons: ["method_not_implemented"],
        }),
      ),
    ).toBe(false);
  });

  it("does not ask for a REIT", () => {
    expect(
      asksQualitativeDecisions(
        selection({
          status: "unsupported_method",
          assetProfile: "reit",
          recommendedMethod: "affo_nav",
          requiredInputs: ["affo", "nav"],
          unsupportedReasons: ["missing_required_input"],
        }),
      ),
    ).toBe(false);
  });
});
