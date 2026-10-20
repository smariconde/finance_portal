import { describe, expect, it } from "vitest";

import { runExcessReturn } from "../application/run-excess-return";
import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { deriveEmployeeEquity } from "./employee-equity-claim";
import { divide, formatDecimal, ONE, parseDecimal } from "./decimal-policy";

/**
 * Independent reference: Damodaran eqexret.xls, Inputs + Excess Return Valuation.
 * Original workbook sha256 and cell map: docs/valuation/financial-equity-oracle.md.
 * Expectations are transcribed from Calc's evaluation of the public workbook,
 * not generated with this engine. No workbook or captured provider data is stored.
 */
describe("eqexret spreadsheet comparison", () => {
  it("matches all ten explicit years and the nonzero terminal in eqexret.xls", () => {
    const input = fixtureFinancialValuation();
    input.commonBookEquity!.value = "17997000000";
    input.risk.riskFree!.value = "0.05";
    input.risk.matureErp!.value = "0.04";
    input.employeeEquity!.sharesOutstanding.value = "1120713000";
    input.employeeEquity!.derived = deriveEmployeeEquity({
      ...input.employeeEquity!,
      riskFree: "0.05",
    });
    const initialPayout = divide(
      parseDecimal("0.92", "dps"),
      parseDecimal("4.75", "eps"),
      "payout",
    );
    const terminalPayout = ONE.minus(
      divide(
        parseDecimal("0.05", "g"),
        parseDecimal("0.15", "roe"),
        "retention",
      ),
    );
    input.assumptions.periods = Array.from({ length: 10 }, (_, index) => {
      const fade = parseDecimal(String(Math.max(0, index - 4)), "fade").div(5);
      return {
        roe: formatDecimal(
          parseDecimal("0.25", "roe").minus(fade.times("0.1")),
          "roe",
        ),
        equityBeta: formatDecimal(
          parseDecimal("1.15", "beta").minus(fade.times("0.05")),
          "beta",
        ),
        payout: formatDecimal(
          initialPayout.plus(fade.times(terminalPayout.minus(initialPayout))),
          "payout",
        ),
      };
    });
    input.assumptions.terminal = {
      roe: "0.15",
      growth: "0.05",
      equityBeta: "1.1",
    };
    const run = runExcessReturn(input, {
      now: () => "2026-10-20T12:00:00.000Z",
      newValuationRunId: () => "f4060000-0000-4000-8000-000000000010",
    });
    expect(run.status).toBe("requires_review");
    const result = run.result!.base;
    // B10:K10, monetary amounts in millions in the public workbook.
    const excessReturns = [
      "2771.538",
      "3330.22171263158",
      "4001.52429996731",
      "4808.14735622388",
      "5777.36863908375",
      "6058.44176981199",
      "6022.02964903832",
      "5641.0638393107",
      "4924.40981607329",
      "3913.07490884859",
    ];
    result.periods.forEach((period, index) => {
      const expected = parseDecimal(excessReturns[index]!, "oracle").times(
        1000000,
      );
      expect(
        parseDecimal(period.excessReturn, "excess")
          .minus(expected)
          .abs()
          .lt("0.01"),
      ).toBe(true);
    });
    // L10, K11, B27 and B29; the workbook terminal beginning book equals
    // year 10 ending book because terminal reinvestment is coherent at 5%.
    expect(Number(result.terminal.excessReturn) / 1000000).toBeCloseTo(
      4108.72865429103,
      7,
    );
    expect(Number(result.terminal.terminalValue) / 1000000).toBeCloseTo(
      93380.1966884324,
      6,
    );
    expect(Number(result.grossEquityValue) / 1000000).toBeCloseTo(
      83990.7586682787,
      6,
    );
    expect(Number(result.valuePerShare)).toBeCloseTo(74.9440389004845, 10);
  });
});
