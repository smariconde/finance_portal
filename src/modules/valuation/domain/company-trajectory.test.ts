import { describe, expect, it } from "vitest";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
} from "./annual-fundamentals";
import {
  COMPANY_TRAJECTORY_VERSION,
  companyTrajectory,
} from "./company-trajectory";

type Values = Partial<Record<LineItemId, string>>;

function year(
  fiscalYearEnd: string,
  values: Values,
  currency: string | null = "USD",
): FiscalYear {
  return {
    fiscalYearEnd,
    items: Object.fromEntries(
      Object.entries(values).map(([item, value], index) => [
        item,
        {
          item: item as LineItemId,
          concept: `us-gaap:Concept${index}`,
          value,
          unit: item === "diluted_shares" ? "shares" : "USD",
          currency: item === "diluted_shares" ? null : currency,
          asOf: fiscalYearEnd,
          observationId: `00000000-0000-4000-8000-00000000000${index}`,
          availableAt: `${fiscalYearEnd}T12:00:00Z`,
          recordedAt: `${fiscalYearEnd}T12:00:00Z`,
          sourceDocumentId: null,
        },
      ]),
    ),
  };
}

const complete: Values = {
  revenue: "1000",
  operating_income: "200",
  net_income: "150",
  diluted_shares: "100",
  operating_cash_flow: "260",
  capital_expenditure: "60",
  cash: "300",
  liquid_investments: "100",
  debt_current_total: "50",
  debt_long_term_noncurrent: "450",
};

/** La serie llega como la entrega la lectura: el más reciente primero. */
function series(...years: FiscalYear[]): AnnualFundamentals {
  return { version: "annual-fundamentals-1.6.0", fiscalYears: years };
}

describe(COMPANY_TRAJECTORY_VERSION, () => {
  it("ordena del ejercicio más viejo al más reciente y lee cada partida", () => {
    const trajectory = companyTrajectory(
      series(
        year("2025-12-31", { ...complete, revenue: "1210" }),
        year("2024-12-31", { ...complete, revenue: "1100" }),
        year("2023-12-31", complete),
      ),
    );

    expect(trajectory.currency).toBe("USD");
    expect(trajectory.years.map((entry) => entry.fiscalYearEnd)).toEqual([
      "2023-12-31",
      "2024-12-31",
      "2025-12-31",
    ]);

    const [first, second] = trajectory.years;
    expect(first!.revenueGrowth).toBeNull();
    expect(second!.revenueGrowth).toEqual({ status: "value", value: "0.1" });
    expect(first!.operatingMargin).toEqual({ status: "value", value: "0.2" });
    expect(first!.dilutedEps).toEqual({ status: "value", value: "1.5" });
    expect(first!.freeCashFlow).toEqual({ status: "value", value: "200" });
    // 300 + 100 de caja contra 50 + 450 de deuda: deuda neta de 100.
    expect(first!.netCash).toEqual({ status: "value", value: "-100" });
    expect(first!.dilutedShares).toEqual({ status: "value", value: "100" });
  });

  it("resume la tendencia entre extremos con su cantidad de años", () => {
    const { summary } = companyTrajectory(
      series(
        year("2025-12-31", {
          ...complete,
          revenue: "1210",
          operating_income: "302.5",
          diluted_shares: "90",
        }),
        year("2024-12-31", { ...complete, operating_cash_flow: "40" }),
        year("2023-12-31", complete),
      ),
    );

    expect(summary.revenueCagr).toEqual({
      status: "value",
      value: "0.1",
      fromFiscalYearEnd: "2023-12-31",
      toFiscalYearEnd: "2025-12-31",
      years: 2,
    });
    expect(summary.operatingMarginChange).toMatchObject({
      status: "value",
      value: "0.05",
    });
    expect(summary.dilutedSharesChange).toMatchObject({
      status: "value",
      value: "-0.1",
    });
    expect(summary.positiveFreeCashFlowYears).toEqual({
      positive: 2,
      measured: 3,
    });
  });

  it("un faltante deja la lectura nula con motivo, nunca en cero", () => {
    const { years } = companyTrajectory(
      series(
        year("2024-12-31", { revenue: "1000", operating_cash_flow: "260" }),
      ),
    );

    expect(years[0]).toMatchObject({
      operatingMargin: { status: "null", reason: "not_reported" },
      dilutedEps: { status: "null", reason: "not_reported" },
      // Sin capex no hay flujo libre: suponerlo cero lo inflaría.
      freeCashFlow: { status: "null", reason: "not_reported" },
      netCash: { status: "null", reason: "not_reported" },
    });
  });

  it("una deuda sin receta no es deuda cero", () => {
    // Sólo el no corriente: ninguna receta cierra con una parte.
    const withoutCurrent = Object.fromEntries(
      Object.entries(complete).filter(([key]) => key !== "debt_current_total"),
    ) as Values;
    const { years } = companyTrajectory(
      series(year("2024-12-31", withoutCurrent)),
    );

    expect(years[0]!.netCash).toEqual({
      status: "null",
      reason: "debt_unresolved",
    });
  });

  it("rechaza márgenes sobre ventas no positivas y EPS sin acciones", () => {
    const { years } = companyTrajectory(
      series(
        year("2024-12-31", { ...complete, revenue: "0", diluted_shares: "0" }),
      ),
    );

    expect(years[0]!.operatingMargin).toEqual({
      status: "null",
      reason: "non_positive_revenue",
    });
    expect(years[0]!.dilutedEps).toEqual({
      status: "null",
      reason: "non_positive_shares",
    });
  });

  it("acepta márgenes y flujos negativos como hechos", () => {
    const { years } = companyTrajectory(
      series(
        year("2024-12-31", {
          ...complete,
          operating_income: "-100",
          net_income: "-80",
          capital_expenditure: "400",
        }),
      ),
    );

    expect(years[0]).toMatchObject({
      operatingMargin: { status: "value", value: "-0.1" },
      dilutedEps: { status: "value", value: "-0.8" },
      freeCashFlow: { status: "value", value: "-140" },
    });
  });

  it("no compara monedas distintas", () => {
    const mixed = year("2024-12-31", complete);
    const { years } = companyTrajectory(
      series({
        ...mixed,
        items: {
          ...mixed.items,
          capital_expenditure: {
            ...mixed.items.capital_expenditure!,
            currency: "EUR",
          },
        },
      }),
    );

    expect(years[0]!.freeCashFlow).toEqual({
      status: "null",
      reason: "currency_mismatch",
    });
  });

  it("una tasa compuesta exige extremos positivos y dos ejercicios", () => {
    const negative = companyTrajectory(
      series(
        year("2025-12-31", complete),
        year("2024-12-31", { ...complete, revenue: "-5" }),
      ),
    );
    const single = companyTrajectory(series(year("2025-12-31", complete)));

    expect(negative.summary.revenueCagr).toEqual({
      status: "null",
      reason: "non_positive_endpoint",
    });
    expect(negative.years[1]!.revenueGrowth).toEqual({
      status: "null",
      reason: "non_positive_revenue",
    });
    expect(single.summary.revenueCagr).toEqual({
      status: "null",
      reason: "insufficient_years",
    });
  });

  it("deja afuera los ejercicios que sólo traen otras partidas", () => {
    const { years } = companyTrajectory(
      series(
        year("2025-12-31", complete),
        year("2017-12-31", { research_development: "40" }),
      ),
    );

    expect(years.map((entry) => entry.fiscalYearEnd)).toEqual(["2025-12-31"]);
  });

  it("una serie vacía no tiene moneda ni ejercicios", () => {
    const trajectory = companyTrajectory(series());

    expect(trajectory.currency).toBeNull();
    expect(trajectory.years).toEqual([]);
    expect(trajectory.summary.positiveFreeCashFlowYears).toEqual({
      positive: 0,
      measured: 0,
    });
  });
});
