import { describe, expect, it } from "vitest";

import { runValuation } from "../application/run-valuation";
import { replayValuationRun } from "../application/replay-valuation-run";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { parseDecimal, formatDecimal } from "./decimal-policy";
import { computeFcff } from "./fcff";
import { checkValuationInput } from "./policy-checks";
import { valueScenarios } from "./scenario-valuation";
import { buildSensitivityGrid } from "./sensitivity";
import { valuationInputSchema } from "./valuation-input";

function input(probability = "0.1") {
  const result = structuredClone(DEMO_VALUATION_INPUT);
  if (result.failureRisk.basis !== "rating_table")
    throw new Error("Expected table fixture");
  result.failureRisk.parameter.value = probability;
  return result;
}
const run = (candidate = input()) =>
  runValuation(candidate, {
    now: () => "2026-08-24T12:00:00.000Z",
    newValuationRunId: () => "70000000-0000-4000-8000-000000000001",
  });
describe("failure adjustment in FCFF", () => {
  it("weights the full DCF by survival and recovers reported capital before the equity bridge", () => {
    const candidate = input();
    const result = computeFcff(candidate),
      original = computeFcff(input("0"));
    const capital = candidate.normalization.investedCapital;
    if (capital.status !== "resolved") throw new Error("Expected book capital");
    const recovery = parseDecimal(capital.reported, "capital").times("0.5");
    const expected = parseDecimal(original.enterpriseValue, "ev")
      .times("0.9")
      .plus(recovery.times("0.1"));
    expect(result.enterpriseValue).toBe(formatDecimal(expected, "ev"));
    expect(result.failureAdjustment).toMatchObject({
      goingConcernValue: original.enterpriseValue,
      proceeds: formatDecimal(recovery, "recovery"),
      probability: "0.1",
    });
    expect(result.periods).toEqual(original.periods);
    expect(result.terminal).toEqual(original.terminal);
    expect(result.terminalValueShare).toBe(original.terminalValueShare);
    const equityChange = parseDecimal(original.equityValue, "eq").minus(
      result.equityValue,
    );
    expect(
      equityChange.eq(
        parseDecimal(original.enterpriseValue, "ev").minus(
          result.enterpriseValue,
        ),
      ),
    ).toBe(true);
  });
  it("uses reported book capital rather than capitalized research or lease adjustments", () => {
    const candidate = input();
    const capital = candidate.normalization.investedCapital;
    if (capital.status !== "resolved") throw new Error("Expected capital");
    capital.adjusted = "999999999";
    expect(computeFcff(candidate).failureAdjustment.proceeds).toBe(
      formatDecimal(
        parseDecimal(capital.reported, "capital").times("0.5"),
        "recovery",
      ),
    );
  });
  it("leaves p=0 unchanged and uses recovery alone at p=1", () => {
    const zero = computeFcff(input("0")),
      certain = computeFcff(input("1"));
    expect(zero.enterpriseValue).toBe(zero.failureAdjustment.goingConcernValue);
    expect(certain.enterpriseValue).toBe(certain.failureAdjustment.proceeds);
  });
  it.each(["0", "-300"])(
    "recovers zero for non-positive book capital %s and names the basis",
    (capital) => {
      const candidate = input();
      if (candidate.normalization.investedCapital.status !== "resolved")
        throw new Error("Expected capital");
      candidate.normalization.investedCapital.reported = capital;
      expect(computeFcff(candidate).failureAdjustment).toMatchObject({
        proceeds: "0",
        proceedsBasis: "non_positive_book_capital",
      });
    },
  );
  it("fails closed for missing probability, missing capital, incompatible currency and non-finite values", () => {
    const absent = input();
    absent.failureRisk = {
      version: "failure-risk-1.0.0",
      basis: "missing",
      reason: "release_missing",
    };
    expect(run(absent)).toMatchObject({ status: "rejected" });
    expect(() => computeFcff(absent)).toThrow();
    const noCapital = input();
    noCapital.normalization.investedCapital = {
      version: "invested-capital-1.0.0",
      status: "unresolved",
      reason: "equity_not_reported",
    };
    expect(
      checkValuationInput(noCapital).find(
        (c) => c.id === "failure_risk_recomputed",
      )?.status,
    ).toBe("failed");
    expect(() => computeFcff(noCapital)).toThrow();
    const mixed = input();
    mixed.normalization.facts.balance.equity!.currency = "EUR";
    expect(run(mixed).status).toBe("rejected");
    for (const value of [null, "NaN", "Infinity"]) {
      const bad = input();
      if (bad.failureRisk.basis !== "rating_table")
        throw new Error("Expected table");
      expect(
        valuationInputSchema.safeParse({
          ...bad,
          failureRisk: {
            ...bad.failureRisk,
            parameter: { ...bad.failureRisk.parameter, value },
          },
        }).success,
      ).toBe(false);
    }
  });
  it("recomputes both scenarios and every computed sensitivity cell with the same p and book basis", () => {
    const candidate = input(),
      base = computeFcff(candidate),
      scenarios = valueScenarios(candidate, base)!;
    for (const scenario of [scenarios.bear, scenarios.bull])
      expect(scenario.failureAdjustment).toMatchObject({
        probability: "0.1",
        proceeds: base.failureAdjustment.proceeds,
      });
    const grid = buildSensitivityGrid(candidate);
    for (const row of grid.rows)
      for (const [i, cell] of row.cells.entries())
        if (cell.status === "computed")
          expect(cell.valuePerShare).toBe(
            computeFcff(candidate, {
              wacc: row.wacc,
              terminalGrowth: grid.terminalGrowth.values[i]!,
            }).valuePerShare,
          );
  });
  it("replays both hashes from the snapshot alone and rejects a mismatched selected rating", () => {
    const outcome = run();
    expect(outcome.status).not.toBe("rejected");
    expect(replayValuationRun(outcome).outcome).toBe("reproduced");
    const tampered = input();
    if (tampered.failureRisk.basis !== "rating_table")
      throw new Error("Expected table");
    tampered.failureRisk.parameter.rowKey = "b";
    expect(run(tampered)).toMatchObject({ status: "rejected" });
  });
});
