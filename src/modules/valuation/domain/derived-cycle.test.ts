import { describe, expect, it } from "vitest";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemValue,
} from "./annual-fundamentals";
import {
  applyDerivedCycle,
  DERIVED_CYCLE_CONVERGENCE_YEARS,
  DERIVED_CYCLE_VERSION,
  deriveCycleHistory,
  derivedCycleNormalization,
} from "./derived-cycle";
import type { MonetaryFact } from "./valuation-facts";
import type { PeriodAssumption, TerminalAssumption } from "./valuation-input";

function year(
  fiscalYearEnd: string,
  revenue: string,
  operatingIncome: string | null,
): FiscalYear {
  const item = (
    key: "revenue" | "operating_income",
    value: string,
  ): LineItemValue => ({
    item: key,
    concept:
      key === "revenue" ? "us-gaap:Revenues" : "us-gaap:OperatingIncomeLoss",
    value,
    unit: "USD",
    currency: "USD",
    asOf: fiscalYearEnd,
    observationId: "70000000-0000-4000-8000-000000000001",
    availableAt: `${fiscalYearEnd.slice(0, 4)}-02-15T12:00:00.000Z`,
    recordedAt: `${fiscalYearEnd.slice(0, 4)}-02-15T12:00:00.000Z`,
    sourceDocumentId: `10-K-${fiscalYearEnd}`,
  });

  return {
    fiscalYearEnd,
    items: {
      revenue: item("revenue", revenue),
      ...(operatingIncome === null
        ? {}
        : { operating_income: item("operating_income", operatingIncome) }),
    },
  };
}

/** Más reciente primero, como la entrega la serie. */
function series(...years: FiscalYear[]): AnnualFundamentals {
  return { version: "annual-fundamentals-1.6.0", fiscalYears: years };
}

const toFact = (item: LineItemValue): MonetaryFact => ({
  value: item.value,
  currency: item.currency ?? "USD",
  unit: "monetary",
  asOf: item.asOf,
  availableAt: item.availableAt,
  sourceId: "sec-edgar",
  sourceDocumentId: item.sourceDocumentId,
  observationId: item.observationId,
  qualityFlags: [],
});

const CONTEXT = {
  toFact,
  industryKey: null,
  preTaxCostOfDebt: null,
  baseEbitAdjusted: "84",
};

/** Un ciclo: valle, pico y vuelta, con 8,4 % de margen en el último año. */
const CYCLE = series(
  year("2025-12-31", "1000", "84"),
  year("2024-12-31", "1100", "112"),
  year("2023-12-31", "1300", "244"),
  year("2022-12-31", "1400", "352"),
  year("2021-12-31", "1200", "308"),
  year("2020-12-31", "800", "40"),
);

describe(DERIVED_CYCLE_VERSION, () => {
  it("arma la historia del más viejo al ejercicio base, con la base ajustada", () => {
    const cycle = deriveCycleHistory(CYCLE, CONTEXT);

    expect(cycle.status).toBe("ready");
    if (cycle.status !== "ready") return;

    expect(cycle.history.map((entry) => entry.fiscalYearEnd)).toEqual([
      "2020-12-31",
      "2021-12-31",
      "2022-12-31",
      "2023-12-31",
      "2024-12-31",
      "2025-12-31",
    ]);
    // El ejercicio base es el EBIT ajustado de la normalización.
    expect(cycle.history.at(-1)?.ebit?.value).toBe("84");
    // Sin arrendamientos ni I+D, el ajuste de un año anterior es su EBIT.
    expect(cycle.history[0]?.ebit?.value).toBe("40");
    expect(cycle.history[0]?.ebit?.sourceDocumentId).toBe("10-K-2020-12-31");
    expect(Number(cycle.historicalMargin)).toBeCloseTo(0.15527, 5);
  });

  it("necesita cinco ejercicios consecutivos con ventas y EBIT", () => {
    const short = series(...CYCLE.fiscalYears.slice(0, 4));
    const broken = series(
      ...CYCLE.fiscalYears.slice(0, 3),
      year("2022-06-30", "1400", "352"),
      ...CYCLE.fiscalYears.slice(4),
    );
    const missingEbit = series(
      ...CYCLE.fiscalYears.slice(0, 2),
      year("2023-12-31", "1300", null),
      ...CYCLE.fiscalYears.slice(3),
    );

    for (const candidate of [short, broken, missingEbit]) {
      expect(deriveCycleHistory(candidate, CONTEXT)).toMatchObject({
        status: "unavailable",
        reason: "insufficient_cycle_years",
      });
    }
  });

  it("no arma un ciclo sin base ajustada ni con margen medio no positivo", () => {
    expect(
      deriveCycleHistory(CYCLE, { ...CONTEXT, baseEbitAdjusted: null }),
    ).toMatchObject({ status: "unavailable", reason: "base_not_adjusted" });

    const losses = series(
      ...CYCLE.fiscalYears.map((entry) =>
        year(entry.fiscalYearEnd, entry.items.revenue!.value, "-50"),
      ),
    );
    expect(
      deriveCycleHistory(losses, { ...CONTEXT, baseEbitAdjusted: "-50" }),
    ).toMatchObject({
      status: "unavailable",
      reason: "non_positive_cycle_margin",
    });
  });

  it("toma diez ejercicios como mucho", () => {
    const long = series(
      ...Array.from({ length: 12 }, (_, index) =>
        year(`${2025 - index}-12-31`, "1000", "100"),
      ),
    );
    const cycle = deriveCycleHistory(long, {
      ...CONTEXT,
      baseEbitAdjusted: "100",
    });

    expect(cycle.status === "ready" && cycle.history).toHaveLength(10);
  });
});

describe("applyDerivedCycle", () => {
  const history = deriveCycleHistory(CYCLE, CONTEXT);
  if (history.status !== "ready") throw new Error("fixture");
  const cycle = derivedCycleNormalization({
    history: history.history,
    profileEvidence: [],
    employeeEquityAvailableAt: "2026-02-15T12:00:00.000Z",
  });
  const periods: PeriodAssumption[] = Array.from(
    { length: 10 },
    (_, index) => ({
      periodIndex: index + 1,
      periodEnd: `${2026 + index}-12-31`,
      revenueGrowth: "0.08",
      ebitMargin: "0.084",
      taxRate: "0.25",
      wacc: "0.09",
      reinvestment: { convention: "sales_to_capital", salesToCapital: "1.2" },
    }),
  ) as PeriodAssumption[];
  const terminal = {
    growth: "0.0396",
    ebitMargin: "0.084",
    taxRate: "0.25",
    wacc: "0.08",
    returnOnCapital: "0.08",
  } as TerminalAssumption;

  const reshaped = applyDerivedCycle(
    { periods, terminal, scenarios: null },
    { cycle, baseRevenue: "1000", baseEbitAdjusted: "84" },
  );

  it("hace crecer las ventas a la tasa terminal desde el año 1", () => {
    expect(
      reshaped.periods.every((period) => period.revenueGrowth === "0.0396"),
    ).toBe(true);
    expect(cycle.convergenceYears).toBe(DERIVED_CYCLE_CONVERGENCE_YEARS);
    expect(cycle.marginShift).toBeNull();
  });

  it("lleva el margen al promedio del ciclo en tres años", () => {
    const margins = reshaped.periods.map((period) => Number(period.ebitMargin));

    expect(margins[0]).toBeGreaterThan(0.084);
    expect(margins[2]).toBeCloseTo(0.15527, 5);
    expect(margins.slice(2).every((margin) => margin === margins[2])).toBe(
      true,
    );
    expect(Number(reshaped.terminal.ebitMargin)).toBe(margins[2]);
    // Lo demás queda como lo armó la regla.
    expect(reshaped.periods[0]?.wacc).toBe("0.09");
    expect(reshaped.terminal.returnOnCapital).toBe("0.08");
  });

  it("mueve bear y bull al peor y al mejor margen del ciclo, a cuatro decimales", () => {
    expect(reshaped.scenarios?.bear.drivers).toEqual([
      expect.objectContaining({ driver: "terminalEbitMargin", value: "0.05" }),
    ]);
    expect(reshaped.scenarios?.bull.drivers).toEqual([
      expect.objectContaining({
        driver: "terminalEbitMargin",
        value: "0.2567",
      }),
    ]);
  });

  it("no publica escenarios cuando el ciclo no se mueve", () => {
    const flat = series(
      ...Array.from({ length: 5 }, (_, index) =>
        year(`${2025 - index}-12-31`, "1000", "100"),
      ),
    );
    const steady = deriveCycleHistory(flat, {
      ...CONTEXT,
      baseEbitAdjusted: "100",
    });
    if (steady.status !== "ready") throw new Error("fixture");

    expect(
      applyDerivedCycle(
        { periods, terminal, scenarios: null },
        {
          cycle: derivedCycleNormalization({
            history: steady.history,
            profileEvidence: [],
            employeeEquityAvailableAt: "2026-02-15T12:00:00.000Z",
          }),
          baseRevenue: "1000",
          baseEbitAdjusted: "100",
        },
      ).scenarios,
    ).toBeNull();
  });
});
