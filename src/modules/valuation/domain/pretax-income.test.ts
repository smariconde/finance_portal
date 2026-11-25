import { describe, expect, it } from "vitest";

import {
  COMPOSED_PRETAX_CONCEPT,
  composePretaxIncome,
  frozenPretaxValue,
  PRETAX_INCOME_VERSION,
} from "./pretax-income";
import {
  buildAnnualFundamentals,
  type FundamentalRow,
} from "./annual-fundamentals";

const leg = (value: string, currency: string | null = "USD") => ({
  value,
  currency,
  asOf: "2025-12-31",
});

describe("composePretaxIncome", () => {
  it("Phillips 66 2025: doméstica + extranjera, corroborada por la conciliación al 21 %", () => {
    const reading = composePretaxIncome({
      fiscalYearEnd: "2025-12-31",
      domestic: leg("1035000000"),
      foreign: leg("4385000000"),
      // 1.138 / 0,21 = 5.419,05: a 0,02 % de la suma.
      statutoryTax: leg("1138000000"),
    });

    expect(reading).toMatchObject({
      status: "composed",
      value: "5420000000",
      composition: { version: PRETAX_INCOME_VERSION },
    });
  });

  it("Tesla 2024: la suma no es el total y la conciliación lo delata", () => {
    // Doméstica + extranjera 8.928 M; la conciliación da 8.986 M (0,65 %).
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("8000000000"),
        foreign: leg("928000000"),
        statutoryTax: leg("1887000000"),
      }),
    ).toEqual({ status: "not_composed", reason: "control_mismatch" });
  });

  it("compone una pérdida con su signo", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2020-12-31",
        domestic: leg("-5292000000"),
        foreign: leg("328000000"),
        statutoryTax: leg("-1042440000"),
      }),
    ).toMatchObject({ status: "composed", value: "-4964000000" });
  });

  it("sin la conciliación no compone: McDonald's, ITW y PayPal quedan ausentes", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("1"),
        foreign: leg("2"),
        statutoryTax: null,
      }),
    ).toEqual({ status: "not_composed", reason: "control_missing" });
  });

  it("sin una de las partes no compone", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("1"),
        foreign: undefined,
        statutoryTax: leg("1"),
      }),
    ).toEqual({ status: "not_composed", reason: "legs_missing" });
  });

  it("no mezcla monedas ni acepta una sin moneda", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("100"),
        foreign: leg("100", "EUR"),
        statutoryTax: leg("42"),
      }),
    ).toEqual({ status: "not_composed", reason: "currency_mismatch" });
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("100", null),
        foreign: leg("100", null),
        statutoryTax: leg("42", null),
      }),
    ).toEqual({ status: "not_composed", reason: "currency_mismatch" });
  });

  it("un ejercicio que no tuvo un año entero al 21 % no se controla con esa tasa", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2018-09-29",
        domestic: leg("100"),
        foreign: leg("100"),
        statutoryTax: leg("42"),
      }),
    ).toEqual({ status: "not_composed", reason: "pre_federal_rate_21" });
  });

  it("un total cero no se compone: no hay escala para el control", () => {
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("100"),
        foreign: leg("-100"),
        statutoryTax: leg("0"),
      }),
    ).toEqual({ status: "not_composed", reason: "zero_total" });
  });

  it("el borde de la tolerancia es inclusivo a 0,5 %", () => {
    // Suma 1.000; 0,21 × 1.005 = 211,05 está justo en el borde.
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("600"),
        foreign: leg("400"),
        statutoryTax: leg("211.05"),
      }).status,
    ).toBe("composed");
    expect(
      composePretaxIncome({
        fiscalYearEnd: "2024-12-31",
        domestic: leg("600"),
        foreign: leg("400"),
        statutoryTax: leg("211.06"),
      }).status,
    ).toBe("not_composed");
  });
});

describe("frozenPretaxValue", () => {
  const fact = (concept: string, value: string) => ({
    concept,
    value,
    currency: "USD",
    unit: "monetary" as const,
    asOf: "2025-12-31",
    availableAt: "2026-02-20T21:00:00.000Z",
    sourceId: "sec-edgar",
    sourceDocumentId: "0001534701-26-000010",
    observationId: null,
    qualityFlags: [] as string[],
  });

  it("recalcula el valor de sus tres hechos y no compone uno adulterado", () => {
    const composition = {
      version: PRETAX_INCOME_VERSION as typeof PRETAX_INCOME_VERSION,
      domestic: fact("d", "1035000000"),
      foreign: fact("f", "4385000000"),
      statutoryTax: fact("s", "1138000000"),
    };

    expect(frozenPretaxValue("2025-12-31", composition)).toBe("5420000000");
    expect(
      frozenPretaxValue("2025-12-31", {
        ...composition,
        statutoryTax: fact("s", "2000000000"),
      }),
    ).toBeNull();
  });
});

describe("la serie compone sólo sin total publicado (`annual-fundamentals-1.10.0`)", () => {
  const row = (
    concept: string,
    value: string,
    asOf: string,
    observationId: string,
  ): FundamentalRow => ({
    observationId,
    subjectId: "00000000-0000-4000-8000-000000000001",
    concept: `us-gaap:${concept}`,
    periodType: "annual",
    asOf,
    periodStart: `${asOf.slice(0, 4)}-01-01`,
    unit: "monetary",
    currency: "USD",
    value,
    availableAt: `${Number(asOf.slice(0, 4)) + 1}-02-20T21:00:00.000Z`,
    recordedAt: "2026-11-25T00:00:00.000Z",
    sourceDocumentId: `doc-${asOf.slice(0, 4)}`,
  });
  const id = (n: number) =>
    `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
  const legs = (asOf: string, offset: number) => [
    row("Revenues", "132376000000", asOf, id(offset)),
    row(
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic",
      "1035000000",
      asOf,
      id(offset + 1),
    ),
    row(
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign",
      "4385000000",
      asOf,
      id(offset + 2),
    ),
    row(
      "IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate",
      "1138000000",
      asOf,
      id(offset + 3),
    ),
  ];

  it("compone con el concepto derivado, sin observación propia y con sus partes", () => {
    const series = buildAnnualFundamentals(
      legs("2025-12-31", 10),
      "2025-12-31",
      "2026-11-25",
    );
    const pretax = series.fiscalYears[0]!.items.pretax_income!;

    expect(pretax).toMatchObject({
      concept: COMPOSED_PRETAX_CONCEPT,
      value: "5420000000",
      observationId: null,
      asOf: "2025-12-31",
      sourceDocumentId: "doc-2025",
      availableAt: "2026-02-20T21:00:00.000Z",
    });
    expect(pretax.composition?.domestic.observationId).toBe(id(11));
  });

  it("con el total publicado lo usa y no compone", () => {
    const series = buildAnnualFundamentals(
      [
        ...legs("2025-12-31", 10),
        row(
          "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
          "5000000000",
          "2025-12-31",
          id(99),
        ),
      ],
      "2025-12-31",
      "2026-11-25",
    );

    expect(series.fiscalYears[0]!.items.pretax_income).toMatchObject({
      value: "5000000000",
      observationId: id(99),
    });
    expect(series.fiscalYears[0]!.items.pretax_income!.composition).toBe(
      undefined,
    );
  });
});
