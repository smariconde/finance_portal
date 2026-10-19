import { describe, expect, it } from "vitest";

import {
  capitalizeResearchAndDevelopment,
  RD_CAPITALIZATION_VERSION,
  type RdFiscalYear,
} from "./rd-capitalization";

/**
 * El ejemplo de Amgen de Damodaran (*Valuing Companies with Intangible Assets*,
 * 2009, tablas 1 y 2): I+D de 2008 hacia atrás, en millones, vida de 10 años.
 * El paper da un activo de 13.283,6, una amortización de 1.694,1 y un EBIT
 * ajustado de 5.594 + 3.030 − 1.694 = 6.930.
 */
const AMGEN_RD = [
  "3030",
  "3266",
  "3366",
  "2314",
  "2028",
  "1655",
  "1117",
  "864",
  "845",
  "823",
  "663",
];

function series(
  amounts: readonly (string | null)[],
  lastYear = 2008,
): RdFiscalYear[] {
  return amounts.map((amount, index) => ({
    fiscalYearEnd: `${lastYear - index}-12-31`,
    amount,
  }));
}

describe("capitalizeResearchAndDevelopment", () => {
  it("reproduces Damodaran's Amgen research asset and amortization", () => {
    const result = capitalizeResearchAndDevelopment({
      fiscalYears: series(AMGEN_RD),
      baseRevenue: "15003",
      industryKey: "drugs-biotechnology",
    });

    expect(result).toMatchObject({
      version: RD_CAPITALIZATION_VERSION,
      status: "capitalized",
      life: { years: 10, lookupRow: "Drug" },
      baseYearRd: "3030",
      researchAsset: "13283.6",
      amortization: "1694.1",
      ebitAdjustment: "1335.9",
      investedCapitalAdjustment: "13283.6",
      netReinvestment: "1335.9",
    });

    if (result.status !== "capitalized") {
      return;
    }

    // El cronograma es la tabla 2 del paper, fila por fila.
    expect(result.schedule).toHaveLength(11);
    expect(result.schedule[1]).toEqual({
      offset: 1,
      fiscalYearEnd: "2007-12-31",
      amount: "3266",
      unamortizedShare: "0.9",
      unamortized: "2939.4",
      amortizationThisYear: "326.6",
    });
    expect(result.schedule[10]).toMatchObject({
      unamortizedShare: "0",
      unamortized: "0",
      amortizationThisYear: "66.3",
    });
    // 5.594 de EBIT reportado más el ajuste: el 6.930 del paper.
    expect(5594 + Number(result.ebitAdjustment)).toBeCloseTo(6929.9, 6);
  });

  it("amortizes software over three years and needs only four", () => {
    const result = capitalizeResearchAndDevelopment({
      fiscalYears: series(["300", "240", "180", "120"]),
      baseRevenue: "2000",
      industryKey: "software-system-and-application",
    });

    // Activo: 300 + 240·2/3 + 180·1/3 = 520; amortización: (240+180+120)/3.
    expect(result).toMatchObject({
      status: "capitalized",
      researchAsset: "520",
      amortization: "180",
      ebitAdjustment: "120",
      rdToRevenue: "0.15",
    });
  });

  it("names an issuer that does not publish R&D, never values it at zero", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series([null, "100"]),
        baseRevenue: "1000",
        industryKey: "machinery",
      }),
    ).toMatchObject({
      status: "not_capitalized",
      reason: "not_reported",
      fiscalYearsAvailable: 0,
    });
  });

  it("leaves R&D below one percent of sales reported", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series(Array(6).fill("9")),
        baseRevenue: "1000",
        industryKey: "semiconductor",
      }),
    ).toMatchObject({
      status: "not_capitalized",
      reason: "immaterial",
      rdToRevenue: "0.009",
    });
  });

  it("capitalizes exactly at the threshold", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series(Array(6).fill("10")),
        baseRevenue: "1000",
        industryKey: "semiconductor",
      }).status,
    ).toBe("capitalized");
  });

  it("refuses a life longer than the history it has, without shortening it", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series(Array(6).fill("100")),
        baseRevenue: "1000",
        industryKey: "drugs-pharmaceutical",
      }),
    ).toMatchObject({
      status: "not_capitalized",
      reason: "insufficient_history",
      life: { years: 10 },
      fiscalYearsAvailable: 6,
    });
  });

  it("stops the history at a missing fiscal year instead of skipping it", () => {
    const withGap = series(Array(6).fill("100"));
    // Falta 2006: 2005 no es «el anterior» de 2007.
    withGap.splice(2, 1);

    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: withGap,
        baseRevenue: "1000",
        industryKey: "semiconductor",
      }),
    ).toMatchObject({
      reason: "insufficient_history",
      fiscalYearsAvailable: 2,
    });
  });

  it("stops the history at a fiscal year without R&D", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series(["100", "100", null, "100", "100", "100"]),
        baseRevenue: "1000",
        industryKey: "semiconductor",
      }),
    ).toMatchObject({
      reason: "insufficient_history",
      fiscalYearsAvailable: 2,
    });
  });

  it("accepts a 52/53-week fiscal year as consecutive", () => {
    const result = capitalizeResearchAndDevelopment({
      fiscalYears: [
        { fiscalYearEnd: "2025-09-27", amount: "100" },
        { fiscalYearEnd: "2024-09-28", amount: "100" },
        { fiscalYearEnd: "2023-09-30", amount: "100" },
        { fiscalYearEnd: "2022-09-24", amount: "100" },
      ],
      baseRevenue: "1000",
      industryKey: "software-internet",
    });

    expect(result.status).toBe("capitalized");
  });

  it("names a company without an industry and an industry without a life", () => {
    const input = {
      fiscalYears: series(Array(11).fill("100")),
      baseRevenue: "1000",
    };

    expect(
      capitalizeResearchAndDevelopment({ ...input, industryKey: null }),
    ).toMatchObject({ reason: "industry_unassigned", life: null });
    expect(
      capitalizeResearchAndDevelopment({
        ...input,
        industryKey: "total-market",
      }),
    ).toMatchObject({ reason: "life_not_declared", life: null });
  });

  it("cannot measure materiality without positive sales", () => {
    for (const baseRevenue of [null, "0", "-5"]) {
      expect(
        capitalizeResearchAndDevelopment({
          fiscalYears: series(Array(6).fill("100")),
          baseRevenue,
          industryKey: "semiconductor",
        }),
      ).toMatchObject({ reason: "revenue_unavailable", rdToRevenue: null });
    }
  });

  it("rejects negative R&D before anything else is measured", () => {
    expect(
      capitalizeResearchAndDevelopment({
        fiscalYears: series(["100", "-1", "100", "100", "100", "100"]),
        baseRevenue: "1000",
        industryKey: "semiconductor",
      }),
    ).toMatchObject({ reason: "rd_negative" });
  });

  it("capitalizes zero R&D in prior years as the reported zero it is", () => {
    const result = capitalizeResearchAndDevelopment({
      fiscalYears: series(["300", "0", "0", "0"]),
      baseRevenue: "1000",
      industryKey: "software-internet",
    });

    expect(result).toMatchObject({
      status: "capitalized",
      researchAsset: "300",
      amortization: "0",
      ebitAdjustment: "300",
    });
  });
});
