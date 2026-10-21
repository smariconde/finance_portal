import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { compareValuationRuns } from "./valuation-run-comparison";

const base = { inputHash: "a".repeat(64), input: DEMO_VALUATION_INPUT };

function changedTo(input: object) {
  return compareValuationRuns(base, { inputHash: "b".repeat(64), input });
}

describe("valuation-run-comparison-1.0.0", () => {
  it("the same snapshot is the same run", () => {
    expect(compareValuationRuns(base, base)).toEqual({ kind: "same_run" });
  });

  it("separates the cutoff from the data", () => {
    expect(
      changedTo({
        ...DEMO_VALUATION_INPUT,
        asOf: "2025-07-01",
        knowledge: {
          ...DEMO_VALUATION_INPUT.knowledge,
          knownAt: "2025-07-01T00:00:00.000Z",
        },
      }),
    ).toEqual({ kind: "changed", cutoffChanged: true, sections: [] });
  });

  it("names each changed section once, in display order", () => {
    expect(
      changedTo({
        ...DEMO_VALUATION_INPUT,
        periods: DEMO_VALUATION_INPUT.periods.map((period) => ({
          ...period,
          ebitMargin: "0.2",
        })),
        terminal: { ...DEMO_VALUATION_INPUT.terminal, growth: "0.01" },
        baseRevenue: { ...DEMO_VALUATION_INPUT.baseRevenue, value: "1" },
      }),
    ).toEqual({
      kind: "changed",
      cutoffChanged: false,
      sections: ["baseRevenue", "assumptions"],
    });
  });

  it("a key present on one side only is a change", () => {
    expect(
      changedTo({
        ...DEMO_VALUATION_INPUT,
        derivedAssumptions: {
          version: "derived-assumptions-1.0.0",
          revenueHistory: [],
        },
      }),
    ).toEqual({
      kind: "changed",
      cutoffChanged: false,
      sections: ["assumptions"],
    });
    expect(
      changedTo({ ...DEMO_VALUATION_INPUT, futureSection: { a: 1 } }),
    ).toEqual({
      kind: "changed",
      cutoffChanged: false,
      sections: ["versions"],
    });
  });

  it("a different hash with identical sections reports no section", () => {
    expect(changedTo({ ...DEMO_VALUATION_INPUT })).toEqual({
      kind: "changed",
      cutoffChanged: false,
      sections: [],
    });
  });
});
