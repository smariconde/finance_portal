import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { runValuation } from "../application/run-valuation";
import {
  consecutiveRevenueHistory,
  deriveAssumptions,
  derivedAssumptionsMismatches,
  DERIVED_ASSUMPTIONS_V2_VERSION,
  DERIVED_ASSUMPTIONS_VERSION,
  INDUSTRY_RETURNS_DATASET,
  measuredGrowth,
  type DerivedAssumptions,
} from "./derived-assumptions";
import { parseDecimal } from "./decimal-policy";
import type { Normalization } from "./normalization";
import type { ValuationInput } from "./valuation-input";

const base = DEMO_VALUATION_INPUT;
const baseYear = base.baseRevenue.asOf;

/** Cuatro ejercicios que crecen 10 % por año hasta el revenue de la corrida. */
const HISTORY: DerivedAssumptions = {
  version: DERIVED_ASSUMPTIONS_VERSION,
  revenueHistory: [
    { fiscalYearEnd: baseYear, value: base.baseRevenue.value },
    {
      fiscalYearEnd: "2023-12-31",
      value: "87272727.27272727272727272727272727",
    },
    {
      fiscalYearEnd: "2022-12-31",
      value: "79338842.97520661157024793388429752",
    },
    {
      fiscalYearEnd: "2021-12-31",
      value: "72126220.88655146506386175807663411",
    },
  ],
};

function derive(
  overrides: Partial<Parameters<typeof deriveAssumptions>[0]> = {},
) {
  return deriveAssumptions({
    derivation: HISTORY,
    baseFiscalYearEnd: baseYear,
    normalization: base.normalization,
    costOfCapital: base.costOfCapital,
    ...overrides,
  });
}

function withBase(change: Partial<Normalization["base"]>): Normalization {
  return {
    ...base.normalization,
    base: { ...base.normalization.base, ...change },
  };
}

function derivedInput(): ValuationInput {
  const result = derive();

  if (result.status !== "derived") {
    throw new Error(result.reason);
  }

  return {
    ...base,
    periods: [...result.periods],
    terminal: result.terminal,
    sensitivity: result.sensitivity,
    scenarios: null,
    derivedAssumptions: HISTORY,
  };
}

describe("derived-assumptions-1.0.0", () => {
  it("holds the starting point five years and converges linearly to the terminal", () => {
    const result = derive();

    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;

    const growth = result.periods.map((period) =>
      parseDecimal(period.revenueGrowth, "growth")
        .toDecimalPlaces(10)
        .toString(),
    );
    const riskFree = parseDecimal(base.costOfCapital.derived.riskFree, "rf");

    expect(
      parseDecimal(result.initialGrowth, "g1").toDecimalPlaces(10).toString(),
    ).toBe("0.1");
    expect(growth.slice(0, 5)).toEqual(["0.1", "0.1", "0.1", "0.1", "0.1"]);
    expect(
      parseDecimal(result.periods[9]!.revenueGrowth, "g10").eq(riskFree),
    ).toBe(true);
    expect(result.terminal.growth).toBe(base.costOfCapital.derived.riskFree);
    expect(result.periods[0]!.wacc).toBe(base.costOfCapital.derived.wacc);
    expect(
      parseDecimal(result.periods[9]!.wacc, "wacc").eq(
        parseDecimal(base.costOfCapital.derived.terminalWacc, "terminal"),
      ),
    ).toBe(true);
    expect(result.terminal.returnOnCapital).toBe(result.terminal.wacc);
    expect(result.periods.map((period) => period.periodEnd)).toEqual(
      Array.from({ length: 10 }, (_, index) => `${2025 + index}-12-31`),
    );
  });

  it("uses the base year's adjusted margin and sales-to-capital throughout", () => {
    const result = derive();
    if (result.status !== "derived") throw new Error("not derived");

    const margin = parseDecimal(
      base.normalization.base.ebitMarginAdjusted!,
      "m",
    );

    for (const period of result.periods) {
      expect(parseDecimal(period.ebitMargin, "m").eq(margin)).toBe(true);
      expect(period.reinvestment.convention).toBe("sales_to_capital");
    }
    expect(parseDecimal(result.terminal.ebitMargin, "m").eq(margin)).toBe(true);
  });

  it("names what is missing instead of filling it", () => {
    expect(
      derive({
        derivation: {
          ...HISTORY,
          revenueHistory: HISTORY.revenueHistory.slice(0, 2),
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "revenue_history_insufficient",
    });
    expect(derive({ baseFiscalYearEnd: "2023-12-31" })).toEqual({
      status: "unavailable",
      reason: "revenue_history_insufficient",
    });
    expect(
      derive({
        derivation: {
          ...HISTORY,
          revenueHistory: [
            ...HISTORY.revenueHistory.slice(0, 3),
            { fiscalYearEnd: "2021-12-31", value: "0" },
          ],
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "revenue_history_non_positive",
    });
    expect(
      derive({
        derivation: {
          ...HISTORY,
          revenueHistory: [
            ...HISTORY.revenueHistory.slice(0, 3),
            { fiscalYearEnd: "2021-12-31", value: "-5" },
          ],
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "revenue_history_non_positive",
    });
    expect(
      derive({ normalization: withBase({ ebitMarginAdjusted: null }) }),
    ).toEqual({
      status: "unavailable",
      reason: "base_margin_unavailable",
    });
    expect(
      derive({ normalization: withBase({ salesToCapitalAdjusted: null }) }),
    ).toEqual({
      status: "unavailable",
      reason: "sales_to_capital_unavailable",
    });
    expect(
      derive({ normalization: withBase({ salesToCapitalAdjusted: "0" }) }),
    ).toEqual({
      status: "unavailable",
      reason: "sales_to_capital_unavailable",
    });
    expect(
      derive({ normalization: withBase({ salesToCapitalAdjusted: "-1.5" }) }),
    ).toEqual({
      status: "unavailable",
      reason: "sales_to_capital_unavailable",
    });
    expect(
      derive({
        normalization: {
          ...base.normalization,
          taxRate: { ...base.normalization.taxRate, applied: null },
        },
      }),
    ).toEqual({ status: "unavailable", reason: "tax_rate_unavailable" });
  });

  it("keeps a declining history as a declining start, never floored", () => {
    const result = derive({
      derivation: {
        ...HISTORY,
        revenueHistory: [
          { fiscalYearEnd: baseYear, value: base.baseRevenue.value },
          { fiscalYearEnd: "2023-12-31", value: "120000000" },
          { fiscalYearEnd: "2022-12-31", value: "150000000" },
        ],
      },
    });

    expect(
      result.status === "derived" &&
        parseDecimal(result.initialGrowth, "g").isNegative(),
    ).toBe(true);
  });
});

describe("consecutiveRevenueHistory", () => {
  const years = [
    { fiscalYearEnd: "2024-12-31", value: "4" },
    { fiscalYearEnd: "2023-12-31", value: "3" },
    { fiscalYearEnd: "2021-12-31", value: "1" },
    { fiscalYearEnd: "2022-12-31", value: "2" },
  ];

  it("starts at the base year and sorts most recent first", () => {
    expect(
      consecutiveRevenueHistory(years, "2024-12-31").map((year) => year.value),
    ).toEqual(["4", "3", "2", "1"]);
  });

  it("cuts the run at a missing fiscal year", () => {
    const gapped = years.filter((year) => year.fiscalYearEnd !== "2022-12-31");

    expect(
      consecutiveRevenueHistory(gapped, "2024-12-31").map((year) => year.value),
    ).toEqual(["4", "3"]);
  });

  it("accepts a 52/53-week year and returns nothing without the base year", () => {
    expect(
      consecutiveRevenueHistory(
        [
          { fiscalYearEnd: "2023-09-30", value: "2" },
          { fiscalYearEnd: "2022-09-24", value: "1" },
        ],
        "2023-09-30",
      ),
    ).toHaveLength(2);
    expect(consecutiveRevenueHistory(years, "2025-12-31")).toEqual([]);
  });

  it("keeps at most six years", () => {
    const long = Array.from({ length: 9 }, (_, index) => ({
      fiscalYearEnd: `${2024 - index}-12-31`,
      value: String(10 - index),
    }));

    expect(consecutiveRevenueHistory(long, "2024-12-31")).toHaveLength(6);
  });
});

describe("assumptions_derived_recomputed", () => {
  it("passes a snapshot whose periods, terminal and grid are the derived ones", () => {
    const input = derivedInput();

    expect(
      derivedAssumptionsMismatches({ ...input, derivation: HISTORY }),
    ).toEqual([]);

    const run = runValuation(input, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000f7",
    });

    expect(run.status).not.toBe("rejected");
    expect(
      run.result?.checks.find(
        (check) => check.id === "assumptions_derived_recomputed",
      )?.status,
    ).toBe("passed");
  });

  it("rejects a hand-written assumption on top of a derivation", () => {
    const input = derivedInput();
    const tampered: ValuationInput = {
      ...input,
      periods: input.periods.map((period, index) =>
        index === 2 ? { ...period, ebitMargin: "0.4" } : period,
      ),
    };
    const run = runValuation(tampered, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000f8",
    });

    expect(run.status).toBe("rejected");
    expect(run.failure?.subjects).toContain("periods");
  });

  it("names a base revenue the history does not start with, and scenarios on a derived run", () => {
    const input = derivedInput();

    expect(
      derivedAssumptionsMismatches({
        ...input,
        derivation: HISTORY,
        baseRevenue: { ...input.baseRevenue, value: "1" },
      }),
    ).toContain("derivedAssumptions.revenueHistory");
    expect(
      derivedAssumptionsMismatches({
        ...input,
        derivation: HISTORY,
        sensitivity: null,
      }),
    ).toContain("sensitivity");
    expect(
      derivedAssumptionsMismatches({
        ...input,
        derivation: HISTORY,
        terminal: { ...input.terminal, returnOnCapital: "0.2" },
      }),
    ).toContain("terminal");
  });

  it("does not run without a derivation, so earlier snapshots keep their checks", () => {
    const run = runValuation(base, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000f9",
    });

    expect(
      run.result?.checks.some(
        (check) => check.id === "assumptions_derived_recomputed",
      ),
    ).toBe(false);
  });
});

/** Cinco ejercicios con ruido: la tendencia y las ventanas no coinciden. */
function historyV2(
  industryValue: string | null,
  rowKey: string = base.costOfCapital.industryKey,
): DerivedAssumptions {
  return {
    version: DERIVED_ASSUMPTIONS_V2_VERSION,
    revenueHistory: [
      { fiscalYearEnd: baseYear, value: base.baseRevenue.value },
      { fiscalYearEnd: "2023-12-31", value: "90000000" },
      { fiscalYearEnd: "2022-12-31", value: "80000000" },
      { fiscalYearEnd: "2021-12-31", value: "75000000" },
      { fiscalYearEnd: "2020-12-31", value: "60000000" },
    ],
    industryReturn:
      industryValue === null
        ? null
        : {
            datasetId: INDUSTRY_RETURNS_DATASET,
            releaseId: "00000000-0000-4000-8000-0000000000e1",
            rowKey,
            field: "roc",
            value: industryValue,
            publishedLabel: "January 2026",
            availableAt: "2026-01-10T00:00:00.000Z",
          },
  };
}

function derivedV2(derivation: DerivedAssumptions): ValuationInput {
  const result = derive({ derivation });

  if (result.status !== "derived") {
    throw new Error(result.reason);
  }

  return {
    ...base,
    periods: [...result.periods],
    terminal: result.terminal,
    sensitivity: result.sensitivity,
    scenarios: result.scenarios,
    derivedAssumptions: derivation,
  };
}

const rounded = (value: string | { toString(): string }) =>
  parseDecimal(String(value), "value").toDecimalPlaces(6).toString();

describe("derived-assumptions-2.0.0", () => {
  it("starts from the log-linear trend, which an exact 10 % history keeps at 10 %", () => {
    const exact = derive({
      derivation: {
        ...HISTORY,
        version: DERIVED_ASSUMPTIONS_V2_VERSION,
        industryReturn: null,
      },
    });

    expect(exact.status).toBe("derived");
    if (exact.status !== "derived") return;
    expect(rounded(exact.initialGrowth)).toBe("0.1");
  });

  it("measures a trend between the window CAGRs on a noisy history", () => {
    const growth = measuredGrowth(historyV2(null).revenueHistory);
    const windows = growth.windows.map((window) => ({
      years: window.years,
      cagr: rounded(window.cagr),
    }));

    // (96/60)^(1/4) − 1 y (96/75)^(1/3) − 1.
    expect(windows).toEqual([
      { years: 4, cagr: "0.124683" },
      { years: 3, cagr: "0.085767" },
    ]);
    expect(growth.trend.greaterThan("0.085767")).toBe(true);
    expect(growth.trend.lessThan("0.124683")).toBe(true);
  });

  it("takes the lower of the industry and the company return, floored at the terminal WACC", () => {
    const basisOf = (industry: string | null) => {
      const result = derive({ derivation: historyV2(industry) });

      if (result.status !== "derived") throw new Error(result.reason);

      return {
        basis: result.terminalReturnBasis,
        value: rounded(result.terminal.returnOnCapital),
      };
    };

    expect(basisOf("0.12")).toEqual({ basis: "industry", value: "0.12" });
    expect(basisOf("0.3")).toEqual({ basis: "company", value: "0.147273" });
    expect(basisOf("0.05")).toEqual({
      basis: "cost_of_capital_floor",
      value: "0.09",
    });
    expect(basisOf(null)).toEqual({
      basis: "no_industry_reference",
      value: "0.09",
    });
  });

  it("falls back to the floor without a company return", () => {
    const result = derive({
      derivation: historyV2("0.12"),
      normalization: withBase({ returnOnCapitalAdjusted: null }),
    });

    expect(result.status === "derived" && result.terminalReturnBasis).toBe(
      "no_company_return",
    );
  });

  it("derives bear and bull from the measured range and the return bounds", () => {
    const result = derive({ derivation: historyV2("0.12") });

    expect(result.status).toBe("derived");
    if (result.status !== "derived" || result.scenarios === null) {
      throw new Error("scenarios expected");
    }

    const { bear, bull } = result.scenarios;
    const growthOf = (scenario: typeof bear) =>
      scenario.drivers.find((driver) => driver.driver === "revenueGrowth");
    const returnOf = (scenario: typeof bear) =>
      scenario.drivers.find(
        (driver) => driver.driver === "terminalReturnOnCapital",
      );
    const bearGrowth = growthOf(bear);
    const bullGrowth = growthOf(bull);

    expect(
      bearGrowth && "values" in bearGrowth && rounded(bearGrowth.values[0]!),
    ).toBe("0.085767");
    expect(
      bullGrowth && "values" in bullGrowth && rounded(bullGrowth.values[0]!),
    ).toBe("0.124683");
    // El año 10 converge al mismo terminal: no cambia nada y no se declara.
    expect(
      bearGrowth && "values" in bearGrowth && bearGrowth.values[9],
    ).toBeNull();
    expect(returnOf(bear)).toMatchObject({ value: "0.09" });
    expect(rounded((returnOf(bull) as { value: string }).value)).toBe(
      "0.147273",
    );
  });

  it("passes the run's checks with ordered scenarios", () => {
    const input = derivedV2(historyV2("0.12"));
    const run = runValuation(input, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000fa",
    });

    expect(run.status).toBe("computed");
    expect(
      run.result?.checks.find(
        (check) => check.id === "assumptions_derived_recomputed",
      )?.status,
    ).toBe("passed");

    const value = (path: string) => parseDecimal(path, "value");
    const scenarios = run.result?.scenarios;

    expect(scenarios).toBeDefined();
    expect(
      value(scenarios!.bear.valuePerShare!).lessThanOrEqualTo(
        value(run.result!.valuePerShare),
      ),
    ).toBe(true);
    expect(
      value(run.result!.valuePerShare).lessThanOrEqualTo(
        value(scenarios!.bull.valuePerShare!),
      ),
    ).toBe(true);
  });

  it("rejects an industry row of another industry and scenarios written by hand", () => {
    const input = derivedV2(historyV2("0.12"));

    expect(
      derivedAssumptionsMismatches({
        ...input,
        derivation: historyV2("0.12", "software-system-and-application"),
      }),
    ).toContain("derivedAssumptions.industryReturn");
    expect(
      derivedAssumptionsMismatches({
        ...input,
        derivation: input.derivedAssumptions!,
        scenarios: null,
      }),
    ).toContain("scenarios");
  });

  it("names a non-positive year inside the window, which a logarithm cannot read", () => {
    const derivation = historyV2(null);
    const result = derive({
      derivation: {
        ...derivation,
        revenueHistory: derivation.revenueHistory.map((year, index) =>
          index === 2 ? { ...year, value: "0" } : year,
        ),
      },
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "revenue_history_non_positive",
    });
  });
});
