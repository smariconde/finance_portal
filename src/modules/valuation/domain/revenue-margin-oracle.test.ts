import { describe, expect, it } from "vitest";
import { runValuation } from "../application/run-valuation";
import { fixtureGrowthValuation } from "../infrastructure/fixture-growth-valuation";
import { computeFcff } from "./fcff";
import { deriveRevenueMargin } from "./revenue-margin";

const deps = {
  now: () => "2025-07-01T00:00:00.000Z",
  newValuationRunId: () => "11111111-1111-4111-8111-111111111111",
};

describe("growth FCFF independent oracles", () => {
  it("reconciles higrowth.xls operating cash flows and loss taxes before the project's distinct convergence rule", () => {
    const input = fixtureGrowthValuation();
    input.baseRevenue.value = "1246.301";
    input.revenueMargin!.lossCarryforward!.value = "1289";
    input.revenueMargin!.lossOffsetLimit = "1";
    const growth = ["0.55", "0.45", "0.4", "0.35"];
    const margins = [
      "0.031666704635736",
      "0.0757742163298287",
      "0.102238723346284",
      "0.118117427556158",
    ];
    input.periods = input.periods.slice(0, 4).map((p, i) => ({
      ...p,
      revenueGrowth: growth[i]!,
      ebitMargin: margins[i]!,
      taxRate: "0.375",
      reinvestment: {
        convention: "sales_to_capital" as const,
        salesToCapital: "3.02",
      },
    }));
    // This isolates the cash-flow kernel. These are the workbook's asymptotic
    // margins, not a valid project linear-convergence snapshot for admission.
    const result = computeFcff(input);
    const expected = [
      [1931.76655, 61.1726807640448, 0, 1227.82731923596, -165.802666918074],
      [2801.0614975, 212.248239864719, 0, 1015.57907937124, -75.5977692412412],
      [3921.4860965, 400.927732126364, 0, 614.651347244872, 29.9262092786819],
      [5294.006230275, 625.314397386355, 3.99864380305588, 0, 166.838888094888],
    ];
    result.periods.forEach((p, i) => {
      const row = expected[i]!;
      [p.revenue, p.ebit, p.lossTax!.taxes, p.lossTax!.closing, p.fcff].forEach(
        (v, j) => expect(Number(v)).toBeCloseTo(row[j]!, 8),
      );
    });
  });

  it("equals a deferred perpetuity plus one finite tax shield, independent of the projection loop", () => {
    const input = fixtureGrowthValuation();
    input.revenueMargin!.initialRevenueGrowth = "0";
    input.revenueMargin!.marginConvergenceYears = 2;
    input.revenueMargin!.lossOffsetLimit = "1";
    input.terminal.growth = "0";
    input.sensitivity = null;
    if (input.failureRisk.basis !== "rating_table") throw new Error("fixture");
    input.failureRisk.parameter.value = "0";
    const path = deriveRevenueMargin(
      input.revenueMargin!,
      input.baseRevenue.value,
      input.normalization.base.ebitAdjusted,
      input.periods.length,
      "0",
    );
    input.periods = input.periods.map((p, i) => ({
      ...p,
      revenueGrowth: path.periodGrowth[i]!,
      ebitMargin: path.periodMargins[i]!,
    }));
    const result = runValuation(input, deps);
    expect(result.status).toBe("requires_review");
    // Year 1 has no cashflow. From year 2: 96m*.20*.75 = 14.4m
    // forever, plus 10m*.25 = 2.5m of tax savings exactly in year 2.
    // EV = (14.4m/.09)/1.09 + 2.5m/(1.09^2).
    expect(Number(result.result!.enterpriseValue)).toBeCloseTo(
      148893190.8088545,
      6,
    );
    expect(result.result!.periods[1]!.lossTax!.taxes).toBe("2300000");
    expect(
      result
        .result!.periods.slice(2)
        .every((p) => p.lossTax!.taxes === "4800000"),
    ).toBe(true);
    expect(result.result!.growthDiagnostics!.unusedLossAtTerminal).toBe("0");
  });
});
