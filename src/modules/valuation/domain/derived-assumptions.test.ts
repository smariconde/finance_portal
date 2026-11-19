import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { runValuation } from "../application/run-valuation";
import {
  consecutiveRevenueHistory,
  consensusRevenueGrowth,
  CONSENSUS_REVENUE_PATH_VERSION,
  deriveAssumptions,
  derivedAssumptionsMismatches,
  DERIVED_ASSUMPTIONS_V2_VERSION,
  DERIVED_ASSUMPTIONS_V3_VERSION,
  DERIVED_ASSUMPTIONS_VERSION,
  explainDerivation,
  selectConsensusRevenue,
  INDUSTRY_CAPITAL_DATASET,
  INDUSTRY_RETURNS_DATASET,
  INDUSTRY_SALES_TO_CAPITAL_FIELD,
  measuredGrowth,
  SALES_TO_CAPITAL_RULE_VERSION,
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

describe("industry-sales-to-capital-1.0.0", () => {
  const industry = (
    value: string,
    rowKey: string = base.costOfCapital.industryKey,
  ): DerivedAssumptions => ({
    ...(historyV2(null) as Extract<
      DerivedAssumptions,
      { version: typeof DERIVED_ASSUMPTIONS_V2_VERSION }
    >),
    industrySalesToCapital: {
      rule: SALES_TO_CAPITAL_RULE_VERSION,
      datasetId: INDUSTRY_CAPITAL_DATASET,
      releaseId: "00000000-0000-4000-8000-0000000000c1",
      rowKey,
      field: INDUSTRY_SALES_TO_CAPITAL_FIELD,
      value,
      publishedLabel: "January 2026",
      availableAt: "2026-01-10T00:00:00.000Z",
    },
  });
  // PLTR y DDOG, 2026-11-18: la caja supera al patrimonio más la deuda.
  const cashRich = withBase({ salesToCapitalAdjusted: "-0.8" });

  it("uses the industry ratio when the company's own is not positive", () => {
    const result = derive({
      derivation: industry("1.54"),
      normalization: cashRich,
    });

    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(
      result.periods.every(
        (period) =>
          period.reinvestment.convention === "sales_to_capital" &&
          period.reinvestment.salesToCapital === "1.54",
      ),
    ).toBe(true);
  });

  it("stays unavailable without an industry ratio", () => {
    expect(
      derive({ derivation: historyV2(null), normalization: cashRich }),
    ).toEqual({
      status: "unavailable",
      reason: "sales_to_capital_unavailable",
    });
  });

  it("keeps the company's own ratio when it is positive", () => {
    const result = derive({ derivation: industry("1.54") });

    expect(result.status).toBe("derived");
    if (result.status !== "derived") return;
    expect(result.periods[0]?.reinvestment).not.toMatchObject({
      salesToCapital: "1.54",
    });
  });

  it("rejects an industry ratio frozen next to a usable own ratio, or for another industry", () => {
    const own = derivedV2(historyV2(null));
    const ownMismatches = derivedAssumptionsMismatches({
      derivation: industry("1.54"),
      baseRevenue: own.baseRevenue,
      normalization: own.normalization,
      costOfCapital: own.costOfCapital,
      periods: own.periods,
      terminal: own.terminal,
      sensitivity: own.sensitivity,
      scenarios: own.scenarios,
    });
    expect(ownMismatches).toContain(
      "derivedAssumptions.industrySalesToCapital",
    );

    const result = derive({
      derivation: industry("1.54"),
      normalization: cashRich,
    });
    if (result.status !== "derived") throw new Error(result.reason);
    const other = derivedAssumptionsMismatches({
      derivation: industry("1.54", "another-industry"),
      baseRevenue: base.baseRevenue,
      normalization: cashRich,
      costOfCapital: base.costOfCapital,
      periods: result.periods,
      terminal: result.terminal,
      sensitivity: result.sensitivity,
      scenarios: result.scenarios,
    });
    expect(other).toEqual(["derivedAssumptions.industrySalesToCapital"]);
  });

  it("recomputes a cash-rich run with the industry ratio and no mismatch", () => {
    const result = derive({
      derivation: industry("1.54"),
      normalization: cashRich,
    });
    if (result.status !== "derived") throw new Error(result.reason);

    expect(
      derivedAssumptionsMismatches({
        derivation: industry("1.54"),
        baseRevenue: base.baseRevenue,
        normalization: cashRich,
        costOfCapital: base.costOfCapital,
        periods: result.periods,
        terminal: result.terminal,
        sensitivity: result.sensitivity,
        scenarios: result.scenarios,
      }),
    ).toEqual([]);
  });
});

/** Un consenso que crece 10 % con un rango de ±5 puntos por año. */
const CAPTURED_AT = "2025-06-29T12:00:00.000Z";
const CONSENSUS_YEARS = [
  {
    periodEnd: "2025-12-31",
    revenueAverage: "105600000",
    revenueLow: "100800000",
    revenueHigh: "110400000",
    analystCount: 12,
    availableAt: CAPTURED_AT,
  },
  {
    periodEnd: "2026-12-31",
    revenueAverage: "116160000",
    revenueLow: "105840000",
    revenueHigh: "126960000",
    analystCount: 11,
    availableAt: CAPTURED_AT,
  },
];

function selectAt(
  overrides: Partial<Parameters<typeof selectConsensusRevenue>[0]> = {},
) {
  return selectConsensusRevenue({
    years: CONSENSUS_YEARS,
    capturedAt: CAPTURED_AT,
    historyEnd: baseYear,
    baseAsOf: baseYear,
    asOf: base.asOf,
    currency: "USD",
    ...overrides,
  });
}

function historyV3(
  consensus = selectAt(),
): Extract<DerivedAssumptions, { version: "derived-assumptions-3.0.0" }> {
  const v2 = historyV2("0.12");
  if (v2.version !== DERIVED_ASSUMPTIONS_V2_VERSION) throw new Error("v2");
  return { ...v2, version: DERIVED_ASSUMPTIONS_V3_VERSION, consensus };
}

/** Una corrida `3.0.0` con un corte que ve la captura. */
function derivedV3(derivation: DerivedAssumptions): ValuationInput {
  return {
    ...derivedV2(derivation),
    knowledge: {
      ...base.knowledge,
      knownAt: "2025-06-30T23:00:00.000Z",
    } as ValuationInput["knowledge"],
  };
}

describe("consensus-revenue-path-1.0.0", () => {
  it("uses FY1 and FY2 right after the history when the capture is current", () => {
    const consensus = selectAt();

    expect(consensus).toMatchObject({
      status: "used",
      rule: CONSENSUS_REVENUE_PATH_VERSION,
      capturedAt: CAPTURED_AT,
      fy1: { periodEnd: "2025-12-31", revenueAverage: "105600000" },
      fy2: { periodEnd: "2026-12-31", revenueAverage: "116160000" },
    });
  });

  it("skips a fiscal year that already closed before FY1", () => {
    const consensus = selectAt({
      years: [
        { ...CONSENSUS_YEARS[0]!, periodEnd: "2024-12-31" },
        ...CONSENSUS_YEARS,
      ],
    });

    expect(consensus.status === "used" && consensus.fy1.periodEnd).toBe(
      "2025-12-31",
    );
  });

  it("names why it is not used, never filling it from the history", () => {
    const reasonOf = (
      overrides: Partial<Parameters<typeof selectConsensusRevenue>[0]>,
    ) => {
      const consensus = selectAt(overrides);
      return consensus.status === "not_used" ? consensus.reason : null;
    };

    expect(reasonOf({ capturedAt: null })).toBe("no_consensus");
    expect(reasonOf({ years: [] })).toBe("no_consensus");
    expect(reasonOf({ capturedAt: "2025-06-01T00:00:00.000Z" })).toBe(
      "stale_consensus",
    );
    expect(reasonOf({ currency: "EUR" })).toBe("currency_mismatch");
    expect(reasonOf({ years: [CONSENSUS_YEARS[0]!] })).toBe(
      "insufficient_horizons",
    );
    // La historia guardada quedó un ejercicio atrás: FY1 es otro año.
    expect(reasonOf({ historyEnd: "2023-12-31" })).toBe("fiscal_year_gap");
    expect(reasonOf({ baseAsOf: "2025-12-31" })).toBe("fiscal_year_gap");
    expect(
      reasonOf({
        years: [
          CONSENSUS_YEARS[0]!,
          { ...CONSENSUS_YEARS[1]!, periodEnd: "2027-12-31" },
        ],
      }),
    ).toBe("fiscal_year_gap");
    expect(
      reasonOf({
        years: [
          { ...CONSENSUS_YEARS[0]!, revenueLow: null },
          CONSENSUS_YEARS[1]!,
        ],
      }),
    ).toBe("revenue_incomplete");
    expect(
      reasonOf({
        years: [
          { ...CONSENSUS_YEARS[0]!, revenueLow: "0" },
          CONSENSUS_YEARS[1]!,
        ],
      }),
    ).toBe("non_positive_revenue");
    expect(
      reasonOf({
        years: [
          { ...CONSENSUS_YEARS[0]!, revenueAverage: "-1" },
          CONSENSUS_YEARS[1]!,
        ],
      }),
    ).toBe("non_positive_revenue");
  });

  it("is exactly FY1/FY0 − 1 and FY2/FY1 − 1 on an annual base", () => {
    const consensus = selectAt();
    if (consensus.status !== "used") throw new Error("used expected");

    const growth = consensusRevenueGrowth({
      consensus,
      level: "revenueAverage",
      anchor: { fiscalYearEnd: baseYear, value: base.baseRevenue.value },
      baseRevenue: base.baseRevenue.value,
      periodEnds: ["2025-12-31", "2026-12-31"],
    });

    expect(growth.map((value) => value.toString())).toEqual(["0.1", "0.1"]);
  });

  it("starts a TTM base from its own revenue and reads the path at each period end", () => {
    const consensus = selectAt({ baseAsOf: "2025-06-30" });
    if (consensus.status !== "used") throw new Error("used expected");

    // El TTM ya creció: 100 M a junio contra 96 M del FY0.
    const [first, second] = consensusRevenueGrowth({
      consensus,
      level: "revenueAverage",
      anchor: { fiscalYearEnd: baseYear, value: "96000000" },
      baseRevenue: "100000000",
      periodEnds: ["2026-06-30", "2027-06-30"],
    });
    const expectedFirst = (105.6e6 * 1.1 ** (181 / 365)) / 100e6 - 1;

    expect(first.toNumber()).toBeCloseTo(expectedFirst, 10);
    // Después de FY2 sigue a la tasa FY1→FY2.
    expect(second.toNumber()).toBeCloseTo(0.1, 10);

    // Un TTM que ya corrió por delante del camino crece menos el año 1:
    // aplicarle FY1/FY0 contaría dos veces lo que ya creció.
    const [ahead] = consensusRevenueGrowth({
      consensus,
      level: "revenueAverage",
      anchor: { fiscalYearEnd: baseYear, value: "96000000" },
      baseRevenue: "104000000",
      periodEnds: ["2026-06-30", "2027-06-30"],
    });
    expect(ahead.toNumber()).toBeCloseTo(
      (105.6e6 * 1.1 ** (181 / 365)) / 104e6 - 1,
      10,
    );
    expect(ahead.toNumber()).toBeLessThan(0.1);
  });
});

describe("derived-assumptions-3.0.0", () => {
  it("takes years 1 and 2 from the consensus and the trend from year 3", () => {
    const result = derive({ derivation: historyV3() });
    const v2 = derive({ derivation: historyV2("0.12") });
    if (result.status !== "derived" || v2.status !== "derived") {
      throw new Error("derived expected");
    }

    const growth = result.periods.map((period) =>
      rounded(period.revenueGrowth),
    );

    expect(growth.slice(0, 2)).toEqual(["0.1", "0.1"]);
    expect(rounded(result.initialGrowth)).toBe("0.1");
    // Desde el año 3, exactamente `2.0.0`.
    expect(result.periods.slice(2)).toEqual(v2.periods.slice(2));
    expect(rounded(v2.periods[0]!.revenueGrowth)).not.toBe("0.1");
    expect(result.terminal).toEqual(v2.terminal);
    expect(result.sensitivity).toEqual(v2.sensitivity);
  });

  it("moves bear and bull to the analysts' low and high for two years only", () => {
    const result = derive({ derivation: historyV3() });
    if (result.status !== "derived" || result.scenarios === null) {
      throw new Error("scenarios expected");
    }

    const growthOf = (scenario: typeof result.scenarios.bear) => {
      const driver = scenario.drivers.find(
        (candidate) => candidate.driver === "revenueGrowth",
      );
      return driver !== undefined && "values" in driver ? driver : null;
    };
    const bear = growthOf(result.scenarios.bear)!;
    const bull = growthOf(result.scenarios.bull)!;

    expect(bear.values.slice(0, 2).map((value) => rounded(value!))).toEqual([
      "0.05",
      "0.05",
    ]);
    expect(bull.values.slice(0, 2).map((value) => rounded(value!))).toEqual([
      "0.15",
      "0.15",
    ]);
    expect(bear.values.slice(2).every((value) => value === null)).toBe(true);
    expect(bear.rationale).toContain(CONSENSUS_REVENUE_PATH_VERSION);
    expect(result.scenarios.bull.thesis).toContain("highest estimate");
  });

  it("is `2.0.0` in everything but the version when the consensus is not used", () => {
    const fallback = derive({
      derivation: historyV3(selectAt({ capturedAt: null })),
    });
    const v2 = derive({ derivation: historyV2("0.12") });

    expect(fallback).toEqual(v2);
  });

  it("passes the run's checks and explains the consensus it froze", () => {
    const derivation = historyV3();
    const input = derivedV3(derivation);
    const run = runValuation(input, {
      now: () => "2026-11-19T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000fb",
    });

    expect(run.status).toBe("computed");
    expect(
      run.result?.checks.find(
        (check) => check.id === "assumptions_derived_recomputed",
      )?.status,
    ).toBe("passed");
    expect(
      explainDerivation({
        derivation,
        normalization: input.normalization,
        costOfCapital: input.costOfCapital,
      })?.consensus,
    ).toMatchObject({ status: "used", capturedAt: CAPTURED_AT });
  });

  it("rejects a consensus the run could not have known or changed by hand", () => {
    const mismatchesOf = (input: ValuationInput) =>
      derivedAssumptionsMismatches({
        derivation: input.derivedAssumptions!,
        baseRevenue: input.baseRevenue,
        normalization: input.normalization,
        costOfCapital: input.costOfCapital,
        periods: input.periods,
        terminal: input.terminal,
        sensitivity: input.sensitivity,
        scenarios: input.scenarios,
        run: {
          asOf: input.asOf,
          knownAt: input.knowledge.knownAt!,
          currency: input.currency,
        },
      });
    const input = derivedV3(historyV3());
    const consensus = historyV3().consensus;
    if (consensus.status !== "used") throw new Error("used expected");

    expect(mismatchesOf(input)).toEqual([]);

    // Capturado después del corte de la corrida.
    expect(
      mismatchesOf({
        ...input,
        knowledge: {
          ...input.knowledge,
          knownAt: "2025-06-29T00:00:00.000Z",
        } as ValuationInput["knowledge"],
      }),
    ).toContain("derivedAssumptions.consensus");

    // El promedio cambiado a mano: el camino ya no es el de los períodos.
    const edited = {
      ...input,
      derivedAssumptions: {
        ...historyV3(),
        consensus: {
          ...consensus,
          fy1: { ...consensus.fy1, revenueAverage: "110000000" },
        },
      },
    };
    expect(mismatchesOf(edited)).toContain("periods");

    // Un `as_of` a más de siete días de la captura.
    expect(mismatchesOf({ ...input, asOf: "2025-07-31" })).toContain(
      "derivedAssumptions.consensus",
    );
  });
});
