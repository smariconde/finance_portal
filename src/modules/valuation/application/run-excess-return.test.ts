import { describe, expect, it } from "vitest";

import { deriveEmployeeEquity } from "../domain/employee-equity-claim";
import { parseDecimal, toFixedScale } from "../domain/decimal-policy";
import { excessReturnInputSchema } from "../domain/excess-return-input";
import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { replayExcessReturnRun, runExcessReturn } from "./run-excess-return";

const dependencies = {
  now: () => "2026-10-20T12:00:00.000Z",
  newValuationRunId: () => "f4060000-0000-4000-8000-000000000001",
};
function value(input = fixtureFinancialValuation()) {
  return runExcessReturn(input, dependencies);
}

describe("financial equity excess-return engine", () => {
  it("values a franchise earning exactly its equity cost at common book", () => {
    const input = fixtureFinancialValuation();
    input.assumptions.periods.forEach((period) => {
      period.roe = "0.1";
    });
    expect(value(input).result!.base.equityValue).toBe("100");
  });

  it("keeps invalid sensitivity cells named and matches the base at its own beta/g", () => {
    const input = fixtureFinancialValuation();
    input.sensitivity = {
      terminalEquityBetas: ["0.1", "1.4", "2"],
      terminalGrowthRates: ["0", "0.03", "0.031"],
    };
    const run = value(input);
    const grid = run.result!.sensitivity!;
    expect(grid.currency).toBe("USD");
    expect(grid.rows[1]!.cells[1]).toEqual({
      status: "computed",
      valuePerShare: run.result!.base.valuePerShare,
    });
    expect(grid.rows[0]!.cells[1]).toEqual({
      status: "rejected",
      reasons: ["financial_terminal_growth"],
    });
    expect(grid.rows.every((row) => row.cells[2]!.status === "rejected")).toBe(
      true,
    );
    expect(grid.rows[2]!.terminalCostOfEquity).toBe("0.13");
    input.sensitivity.terminalEquityBetas = Array(12).fill("1");
    expect(() => value(input)).toThrow();
  });

  it("keeps schema-valid but economically inverted scenarios under review", () => {
    const input = fixtureFinancialValuation();
    const bear = structuredClone(input.assumptions),
      bull = structuredClone(input.assumptions);
    bear.periods[0]!.roe = "0.2";
    bull.periods[0]!.roe = "0.11";
    input.scenarios = { bear, bull };
    const run = value(input);
    expect(run.status).toBe("requires_review");
    expect(
      run.result!.checks.find(
        (check) => check.id === "financial_scenario_order",
      )!.status,
    ).toBe("failed");
  });

  it("refuses stale share counts and missing note availability", () => {
    const input = fixtureFinancialValuation();
    input.employeeEquity!.sharesOutstanding.asOf = "2024-12-31";
    expect(value(input).failure!.subjects).toContain(
      "employeeEquity.sharesOutstanding.asOf",
    );
    input.employeeEquity!.sharesOutstanding.asOf = input.asOf;
    input.employeeEquityAvailableAt = null;
    expect(value(input).failure!.subjects).toContain(
      "employee_equity_availability",
    );
  });

  it("includes evidence exactly at availability and excludes it one second earlier", () => {
    const input = fixtureFinancialValuation();
    if (input.knowledge.revisionPolicy !== "as_known")
      throw new Error("Expected historical fixture.");
    input.knowledge.knownAt = "2025-07-15T12:00:00.000Z";
    expect(value(input).status).toBe("requires_review");
    input.knowledge.knownAt = "2025-07-15T11:59:59.000Z";
    expect(value(input).status).toBe("rejected");
  });

  it("records all invalid periods across three maximum-horizon forecasts", () => {
    const input = fixtureFinancialValuation();
    input.assumptions.periods = Array.from({ length: 20 }, () => ({
      roe: "-1",
      payout: "2",
      equityBeta: "1",
    }));
    const bear = structuredClone(input.assumptions),
      bull = structuredClone(input.assumptions);
    bear.terminal.roe = "0.11";
    bull.terminal.roe = "0.12";
    input.scenarios = { bear, bull };
    const run = value(input);
    expect(run.status).toBe("rejected");
    expect(run.failure!.subjects).toHaveLength(60);
  });

  it.each(["bank", "insurer"] as const)(
    "values %s on beginning common book with annual retention",
    (assetProfile) => {
      const input = fixtureFinancialValuation();
      input.assetProfile = assetProfile;
      input.profileEvidence[0]!.profile = assetProfile;
      const run = value(input);
      expect(run.status).toBe("requires_review");
      expect(run.result!.base.periods[0]).toMatchObject({
        beginningBookEquity: "100",
        netIncome: "12",
        distributions: "6",
        retainedEarnings: "6",
        endingBookEquity: "106",
        equityCharge: "10",
        excessReturn: "2",
        costOfEquity: "0.1",
      });
      expect(run.result!.base.periods[1]).toMatchObject({
        beginningBookEquity: "106",
        netIncome: "12.72",
        endingBookEquity: "112.36",
        excessReturn: "2.12",
      });
      expect(run.result!.base.terminal).toMatchObject({
        beginningBookEquity: "112.36",
        retention: "0.3",
        payout: "0.7",
        terminalValue: "0",
      });
      // Hand calculation: 100 + 2/1.1 + 2.12/1.21 = 12532/121.
      expect(
        toFixedScale(
          parseDecimal(run.result!.base.equityValue, "equity"),
          10,
          "equity",
        ),
      ).toBe("103.5702479339");
      expect(run.result).toMatchObject({
        modelStatus: "experimental",
        rigor: "screening",
      });
    },
  );

  it("reconciles to an independent dividend-discount calculation", () => {
    const run = value();
    const result = run.result!.base;
    // Two explicit distributions + the full equity terminal, calculated in JS
    // solely as an independent oracle (never used by production arithmetic).
    const ddm =
      6 / 1.1 +
      6.36 / 1.1 ** 2 +
      (112.36 * 0.1 * 0.7) / (0.1 - 0.03) / 1.1 ** 2;
    expect(Number(result.equityValue)).toBeCloseTo(ddm, 10);
  });

  it("reproduces both hashes without I/O and detects snapshot or result tampering", () => {
    const first = value();
    const later = runExcessReturn(first.input, {
      ...dependencies,
      now: () => "2026-10-20T14:00:00.000Z",
      newValuationRunId: () => "f4060000-0000-4000-8000-000000000002",
    });
    expect(later.inputHash).toBe(first.inputHash);
    expect(later.resultHash).toBe(first.resultHash);
    expect(replayExcessReturnRun(first).outcome).toBe("reproduced");
    const altered = structuredClone(first);
    altered.input.assumptions.periods[0]!.roe = "0.13";
    expect(replayExcessReturnRun(altered).outcome).toBe("diverged");
    altered.input = first.input;
    altered.result!.base.valuePerShare = "999";
    // Recomputing must also compare the stored result body to its hash.
    expect(replayExcessReturnRun(altered).outcome).toBe("diverged");
  });

  it.each([
    "commonBookEquity",
    "employeeEquity",
    "riskFree",
    "matureErp",
    "countryRiskPremium",
  ] as const)("names missing %s instead of using zero", (key) => {
    const input = fixtureFinancialValuation();
    if (key === "commonBookEquity" || key === "employeeEquity")
      input[key] = null;
    else input.risk[key] = null;
    const run = value(input);
    expect(run.status).toBe("rejected");
    expect(run.failure!.subjects.length).toBeGreaterThan(0);
    expect(run.result).toBeNull();
    expect(replayExcessReturnRun(run).outcome).toBe("reproduced");
  });

  it.each(["0", "-1"])("refuses common book %s", (book) => {
    const input = fixtureFinancialValuation();
    input.commonBookEquity!.value = book;
    expect(value(input).status).toBe("rejected");
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e3", ""])(
    "rejects noncanonical or nonfinite %s",
    (number) => {
      const input = fixtureFinancialValuation();
      input.assumptions.periods[0]!.roe = number;
      expect(() => value(input)).toThrow();
    },
  );

  it("rejects null forecasts and industrial FCFF fields at the boundary", () => {
    const input = fixtureFinancialValuation();
    expect(
      excessReturnInputSchema.safeParse({
        ...input,
        assumptions: { ...input.assumptions, periods: null },
      }).success,
    ).toBe(false);
    expect(
      excessReturnInputSchema.safeParse({ ...input, bridge: { debt: "999" } })
        .success,
    ).toBe(false);
  });

  it.each([
    "book-currency",
    "risk-currency",
    "future-fact",
    "future-note",
    "future-classification",
    "wrong-profile",
    "system-recorded",
    "stale-book",
    "negative-shares",
    "zero-shares",
  ])("refuses %s", (fault) => {
    const input = fixtureFinancialValuation();
    if (fault === "book-currency") input.commonBookEquity!.currency = "ARS";
    if (fault === "risk-currency") input.risk.riskFree!.currency = "ARS";
    if (fault === "future-fact")
      input.commonBookEquity!.availableAt = "2099-01-01T00:00:00.000Z";
    if (fault === "future-note")
      input.employeeEquityAvailableAt = "2099-01-01T00:00:00.000Z";
    if (fault === "future-classification")
      input.profileEvidence[0]!.availableAt = "2099-01-01T00:00:00.000Z";
    if (fault === "wrong-profile") input.profileEvidence[0]!.profile = "reit";
    if (
      fault === "system-recorded" &&
      input.knowledge.revisionPolicy === "as_known"
    )
      input.knowledge.knowledgeBasis = "system_recorded";
    if (fault === "stale-book") input.commonBookEquity!.asOf = "2024-12-31";
    if (fault === "negative-shares" || fault === "zero-shares") {
      input.employeeEquity!.sharesOutstanding.value =
        fault === "zero-shares" ? "0" : "-1";
      input.employeeEquity!.derived = deriveEmployeeEquity({
        ...input.employeeEquity!,
        riskFree: "0.03",
      });
    }
    expect(value(input).status).toBe("rejected");
  });

  it.each([
    "payout-low",
    "payout-high",
    "loss",
    "negative-beta",
    "zero-terminal-roe",
    "growth-above-roe",
    "growth-above-rf",
    "spread-buffer",
  ])("rejects incoherent %s", (fault) => {
    const input = fixtureFinancialValuation();
    if (fault === "payout-low") input.assumptions.periods[0]!.payout = "-0.1";
    if (fault === "payout-high") input.assumptions.periods[0]!.payout = "1.1";
    if (fault === "loss") input.assumptions.periods[0]!.roe = "-0.1";
    if (fault === "negative-beta")
      input.assumptions.periods[0]!.equityBeta = "-1";
    if (fault === "zero-terminal-roe") input.assumptions.terminal.roe = "0";
    if (fault === "growth-above-roe") input.assumptions.terminal.roe = "0.02";
    if (fault === "growth-above-rf")
      input.assumptions.terminal.growth = "0.031";
    if (fault === "spread-buffer")
      input.assumptions.terminal.equityBeta = "0.1";
    expect(value(input).status).toBe("rejected");
  });

  it("accepts g equal to risk-free, g=0, and payout endpoints without free growth", () => {
    for (const payout of ["0", "1"]) {
      const input = fixtureFinancialValuation();
      input.assumptions.periods[0]!.payout = payout;
      input.assumptions.terminal.growth = "0";
      expect(value(input).status).toBe("requires_review");
      expect(value(input).result!.base.terminal.retention).toBe("0");
    }
    expect(value().status).toBe("requires_review");
  });

  it("preserves negative excess returns instead of clamping value to book", () => {
    const input = fixtureFinancialValuation();
    input.assumptions.periods.forEach((period) => {
      period.roe = "0.05";
    });
    input.assumptions.terminal.roe = "0.05";
    const result = value(input).result!.base;
    expect(parseDecimal(result.equityValue, "equity").lt(100)).toBe(true);
    expect(parseDecimal(result.terminal.presentValue, "pv").lt(0)).toBe(true);
  });

  it("revalues coherent scenarios and propagates a scenario refusal", () => {
    const input = fixtureFinancialValuation();
    const bear = structuredClone(input.assumptions),
      bull = structuredClone(input.assumptions);
    bear.periods.forEach((period) => {
      period.roe = "0.1";
    });
    bull.periods.forEach((period) => {
      period.roe = "0.14";
    });
    input.scenarios = { bear, bull };
    const result = value(input).result!;
    expect(result.scenarios!.bear.periods[0]!.netIncome).toBe("10");
    expect(result.scenarios!.bull.periods[0]!.netIncome).toBe("14");
    expect(
      result.checks.find((check) => check.id === "financial_scenario_order")!
        .status,
    ).toBe("passed");
    input.scenarios.bear.terminal.growth = "0.04";
    expect(value(input).failure!.subjects).toContain("scenarios.bear.terminal");
  });

  it("refuses unchanged scenarios and mismatched horizons", () => {
    const input = fixtureFinancialValuation();
    input.scenarios = {
      bear: structuredClone(input.assumptions),
      bull: structuredClone(input.assumptions),
    };
    expect(value(input).status).toBe("rejected");
    input.scenarios.bear.periods.pop();
    expect(value(input).status).toBe("rejected");
  });

  it("subtracts employee options once and uses outstanding shares plus units", () => {
    const input = fixtureFinancialValuation();
    // The existing frozen synthetic note has 300k options and 200k units.
    const withOptions = fixtureFinancialValuation();
    withOptions.employeeEquity = structuredClone(
      DEMO_VALUATION_INPUT.employeeEquity,
    );
    withOptions.employeeEquity.derived = deriveEmployeeEquity({
      ...withOptions.employeeEquity,
      riskFree: "0.03",
    });
    const result = value(withOptions).result!.base;
    expect(result.shareCount).toBe("12500000");
    expect(
      parseDecimal(result.grossEquityValue, "gross")
        .minus(result.employeeOptionValue)
        .toString(),
    ).toBe(result.equityValue);
    expect(result.grossEquityValue).toBe(
      value(input).result!.base.grossEquityValue,
    );
  });

  it("satisfies monotonicity over a deterministic range of ROE and equity costs", () => {
    let last = -Infinity;
    for (let i = 5; i <= 20; i++) {
      const input = fixtureFinancialValuation();
      input.assumptions.periods.forEach((period) => {
        period.roe = String(i / 100);
      });
      const price = Number(value(input).result!.base.valuePerShare);
      expect(price).toBeGreaterThan(last);
      last = price;
      const costlier = structuredClone(input);
      costlier.risk.matureErp!.value = "0.06";
      expect(Number(value(costlier).result!.base.valuePerShare)).toBeLessThan(
        price,
      );
    }
  });
});
