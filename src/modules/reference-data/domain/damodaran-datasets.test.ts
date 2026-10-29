import { describe, expect, it } from "vitest";

import {
  FIXTURE_BETA_HEADERS,
  fixtureBetaRows,
  fixtureBetasPage,
  FIXTURE_EVA_HEADERS,
  fixtureEvaPage,
  FIXTURE_MARGIN_HEADERS,
  fixtureMarginPage,
  FIXTURE_BREAKDOWN_HEADERS,
  fixtureCountryRiskWorkbook,
  fixtureImpliedErpPage,
  fixtureRatingsPage,
} from "../infrastructure/fixture-damodaran-pages";
import { buildZip } from "../infrastructure/fixture-xlsx";
import {
  DAMODARAN_COUNTRY_RISK_WORKBOOK,
  DAMODARAN_WORKBOOK_PARSER_VERSION,
  findDamodaranDataset,
  numberTextToDecimal,
  parseDamodaranDataset,
  percentToFraction,
  rowKeyOf,
} from "./damodaran-datasets";

function parse(datasetId: string, body: string | Uint8Array) {
  return parseDamodaranDataset(findDamodaranDataset(datasetId)!, body);
}

describe("percentToFraction", () => {
  it.each([
    ["40.20", "0.402"],
    ["5.02", "0.0502"],
    ["0.42", "0.0042"],
    ["164.19", "1.6419"],
    ["19.00", "0.19"],
    ["100", "1"],
    ["0", "0"],
    ["-2.5", "-0.025"],
    ["0.005", "0.00005"],
  ])("moves the point of %s%% exactly to %s", (digits, fraction) => {
    expect(percentToFraction(digits)).toBe(fraction);
  });
});

describe("damodaran-html-1.1.0: industry operating margins", () => {
  it("keeps only the pretax lease and R&D adjusted margin and its row count", () => {
    const result = parse("damodaran.margins-us", fixtureMarginPage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(52);
    expect(
      result.rows.find((row) => row.key === "total-market-without-financials")
        ?.values,
    ).toEqual({
      firms: "12",
      pretax_lease_rd_adjusted_margin: "0.14",
    });
  });

  it("rejects a shifted header before publishing a plausible wrong margin", () => {
    const headers = [...FIXTURE_MARGIN_HEADERS];
    [headers[8], headers[9]] = [headers[9]!, headers[8]!];
    expect(
      parse("damodaran.margins-us", fixtureMarginPage({ headers })),
    ).toEqual({
      ok: false,
      code: "header_mismatch",
    });
  });

  it("keeps a missing target as null, never zero", () => {
    const result = parse(
      "damodaran.margins-us",
      fixtureMarginPage({ targetMargin: "NA" }),
    );
    if (!result.ok) throw new Error(result.code);
    expect(
      result.rows.find((row) => row.key === "total-market-without-financials")
        ?.values.pretax_lease_rd_adjusted_margin,
    ).toBeNull();
  });
});

describe("rowKeyOf", () => {
  it("keeps keys stable across a mid-cycle note and punctuation", () => {
    expect(rowKeyOf("Turkey (updated February 2026)")).toBe("turkey");
    expect(rowKeyOf("Software (System & Application)")).toBe(
      "software-system-and-application",
    );
    expect(rowKeyOf("Total Market (without financials)")).toBe(
      "total-market-without-financials",
    );
    expect(rowKeyOf("Côte d'Ivoire")).toBe("cote-d-ivoire");
  });
});

describe("damodaran-html-1.0.0: industry betas", () => {
  it("reads every row with exact fractions and the published label", () => {
    const result = parse("damodaran.betas-us", fixtureBetasPage());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publishedLabel).toBe("January 2026");
    expect(result.rows).toHaveLength(54);
    expect(
      result.rows.find((row) => row.key === "software-system-and-application"),
    ).toEqual({
      key: "software-system-and-application",
      label: "Software (System & Application)",
      values: {
        firms: "300",
        beta: "1.28",
        debt_to_equity: "0.0558",
        effective_tax_rate: "0.0551",
        unlevered_beta: "1.23",
        cash_to_firm_value: "0.0183",
        unlevered_beta_cash_corrected: "1.25",
        hilo_risk: "0.5741",
        equity_volatility: "0.5679",
        operating_income_volatility: "0.4863",
      },
    });
  });

  it("keeps NA as null, never zero", () => {
    const result = parse("damodaran.betas-us", fixtureBetasPage());
    if (!result.ok) throw new Error(result.code);

    expect(
      result.rows.find((row) => row.key === "total-market-without-financials")
        ?.values.operating_income_volatility,
    ).toBeNull();
  });

  it("rejects the whole page when a column moves", () => {
    const swapped = [...FIXTURE_BETA_HEADERS];
    [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];

    expect(
      parse("damodaran.betas-us", fixtureBetasPage({ headers: swapped })),
    ).toEqual({
      ok: false,
      code: "header_mismatch",
    });
  });

  it("rejects a row with an unreadable cell by name, not by value", () => {
    const rows = fixtureBetaRows();
    rows[0] = [
      "Industry 01",
      "10",
      "one point one",
      "25.00%",
      "12.50%",
      "0.95",
      "4.00%",
      "1.00",
      "0.5",
      "40%",
      "20%",
    ];
    const result = parse("damodaran.betas-us", fixtureBetasPage({ rows }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejections).toEqual([{ row: 0, field: "beta" }]);
    expect(result.rows.some((row) => row.key === "industry-01")).toBe(false);
  });

  it("refuses a truncated page instead of storing part of it", () => {
    expect(
      parse(
        "damodaran.betas-us",
        fixtureBetasPage({ rows: fixtureBetaRows(10) }),
      ),
    ).toEqual({ ok: false, code: "too_few_rows" });

    const withoutTotal = fixtureBetaRows(60).slice(0, 60);
    expect(
      parse("damodaran.betas-us", fixtureBetasPage({ rows: withoutTotal })),
    ).toEqual({ ok: false, code: "too_few_rows" });
  });

  it("refuses a page without the table", () => {
    expect(
      parse("damodaran.betas-us", "<html><body>maintenance</body></html>"),
    ).toEqual({
      ok: false,
      code: "header_row_missing",
    });
  });
});

describe("damodaran-html-1.0.0: implied ERP and ratings", () => {
  it("reads implied ERP by year and leaves the first year's blank premium null", () => {
    const result = parse("damodaran.implied-erp", fixtureImpliedErpPage());
    if (!result.ok) throw new Error(result.code);

    expect(result.rows[0]).toMatchObject({
      key: "1960",
      values: { implied_erp: null },
    });
    expect(result.rows.find((row) => row.key === "2025")?.values).toMatchObject(
      {
        treasury_bond_rate: "0.0418",
        implied_erp: "0.0423",
      },
    );
  });

  it("splits the side-by-side rating table into two sets of bands", () => {
    const result = parse("damodaran.synthetic-ratings", fixtureRatingsPage());
    if (!result.ok) throw new Error(result.code);

    expect(result.rows).toHaveLength(30);
    expect(
      result.rows.find((row) => row.key === "large-nonfinancial-04")?.values,
    ).toEqual({
      coverage_above: "0.8",
      coverage_at_most: "1.249999",
      rating: "Caa/CCC",
      spread: "0.0885",
    });
    expect(
      result.rows.filter((row) => row.key.startsWith("financial-")),
    ).toHaveLength(15);
  });
});

describe("numberTextToDecimal", () => {
  it.each([
    ["4.2000000000000003E-2", "0.042000000000000003"],
    ["2.1863536781947081E-3", "0.0021863536781947081"],
    ["0.99999999999999989", "0.99999999999999989"],
    ["1.0000000000000007", "1.0000000000000007"],
    ["28750956.130731199", "28750956.130731199"],
    ["0.25", "0.25"],
    ["1E3", "1000"],
    ["1.5E+2", "150"],
    ["-3.1E-2", "-0.031"],
    ["0", "0"],
    ["-0", "0"],
    ["0.000", "0"],
  ])("writes %s exactly as %s", (text, decimal) => {
    expect(numberTextToDecimal(text)).toBe(decimal);
  });

  it.each(["", "NA", "1,5", "1e", "Infinity", "NaN", "1E999"])(
    "refuses %s instead of guessing",
    (text) => {
      expect(numberTextToDecimal(text)).toBeNull();
    },
  );
});

describe("damodaran-xlsx-1.0.0: country risk and its regions", () => {
  it("reads countries from the breakdown sheet with exact fractions and the pinned label", () => {
    const result = parse(
      "damodaran.country-risk",
      fixtureCountryRiskWorkbook(),
    );
    if (!result.ok) throw new Error(result.code);

    expect(result.parserVersion).toBe(DAMODARAN_WORKBOOK_PARSER_VERSION);
    expect(result.publishedLabel).toBe(
      DAMODARAN_COUNTRY_RISK_WORKBOOK.publishedLabel,
    );
    expect(result.rows).toHaveLength(104);
    expect(result.rejections).toEqual([]);
    expect(result.rows.find((row) => row.key === "united-states")).toEqual({
      key: "united-states",
      label: "United States",
      values: {
        gdp_millions: "28750956.130731199",
        moodys_rating: "Aa1",
        sovereign_cds: "0.0055999999999999999",
        default_spread: "0.0021863536781947081",
        equity_risk_premium: "0.044200000000000003",
        country_risk_premium: "0.0021863536781947081",
        corporate_tax_rate: "0.25",
        region: "North America",
      },
    });
  });

  it("keeps the keys the HTML gave: accents and ampersands normalize the same way", () => {
    const result = parse(
      "damodaran.country-risk",
      fixtureCountryRiskWorkbook(),
    );
    if (!result.ok) throw new Error(result.code);

    const keys = result.rows.map((row) => row.key);
    expect(keys).toContain("st-vincent-and-the-grenadines");
    expect(keys).toContain("cote-d-ivoire");
  });

  it("keeps NA and a formula error as null, never zero", () => {
    const result = parse(
      "damodaran.country-risk",
      fixtureCountryRiskWorkbook(),
    );
    if (!result.ok) throw new Error(result.code);

    expect(
      result.rows.find((row) => row.key === "country-001")?.values
        .sovereign_cds,
    ).toBeNull();
    expect(
      result.rows.find((row) => row.key === "cote-d-ivoire")?.values
        .sovereign_cds,
    ).toBeNull();
  });

  it("reads only the rows that close a region from the weighted sheet", () => {
    const result = parse(
      "damodaran.country-risk-regions",
      fixtureCountryRiskWorkbook(),
    );
    if (!result.ok) throw new Error(result.code);

    expect(result.rows.map((row) => row.key)).toEqual([
      "africa",
      "asia",
      "australia-and-new-zealand",
      "caribbean",
      "central-and-south-america",
      "eastern-europe",
      "middle-east",
      "north-america",
      "western-europe",
    ]);
    expect(result.rows.find((row) => row.key === "north-america")).toEqual({
      key: "north-america",
      label: "North America",
      values: {
        gdp_millions: "8000",
        default_spread: "0.047486708416285141",
        equity_risk_premium: "0.11581787578987807",
        country_risk_premium: "0.002028087891797981",
        corporate_tax_rate: "0.27390173905276305",
      },
    });
  });

  it("rejects the whole sheet when a column moves", () => {
    const moved = [...FIXTURE_BREAKDOWN_HEADERS];
    [moved[5], moved[6]] = [moved[6]!, moved[5]!];

    expect(
      parse(
        "damodaran.country-risk",
        fixtureCountryRiskWorkbook({ breakdownHeaders: moved }),
      ),
    ).toEqual({ ok: false, code: "header_mismatch" });
  });

  it("rejects a truncated sheet", () => {
    expect(
      parse(
        "damodaran.country-risk",
        fixtureCountryRiskWorkbook({ countries: 10 }),
      ),
    ).toEqual({ ok: false, code: "too_few_rows" });
  });

  it("names what the reader refused, and never reads a workbook as text", () => {
    expect(parse("damodaran.country-risk", buildZip([]))).toEqual({
      ok: false,
      code: "xlsx_part_missing",
    });
    expect(parse("damodaran.country-risk", "<html></html>")).toEqual({
      ok: false,
      code: "workbook_expected",
    });
  });

  it("reads both datasets from the same pinned file", () => {
    expect(findDamodaranDataset("damodaran.country-risk")!.url).toBe(
      DAMODARAN_COUNTRY_RISK_WORKBOOK.url,
    );
    expect(findDamodaranDataset("damodaran.country-risk-regions")!.url).toBe(
      DAMODARAN_COUNTRY_RISK_WORKBOOK.url,
    );
  });
});

describe("damodaran-html-1.1.0: industry returns (EVA)", () => {
  it("reads the after-tax ROC and skips the dollar columns it only verifies", () => {
    const result = parse("damodaran.eva-us", fixtureEvaPage());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rejections).toEqual([]);
    expect(result.rows).toHaveLength(55);
    expect(
      result.rows.find((row) => row.key === "computers-peripherals")?.values,
    ).toEqual({
      firms: "36",
      beta: "1.35",
      roe: "-0.0017",
      cost_of_equity: "0.0997",
      roe_minus_coe: "-0.1015",
      roc: "0.4476",
      cost_of_capital: "0.0971",
      roc_minus_wacc: "0.3505",
    });
    expect(
      result.rows.find((row) => row.key === "bank-money-center")?.values.roc,
    ).toBeNull();
  });

  it("reads an Excel error cell as null, and keeps the row's ROC", () => {
    const page = fixtureEvaPage().replace(
      "<td class=xl1>-10.15%</td>",
      "<td class=xl1>#VALUE!</td>",
    );
    const result = parse("damodaran.eva-us", page);

    if (!result.ok) throw new Error(result.code);

    const row = result.rows.find(
      (entry) => entry.key === "computers-peripherals",
    );

    expect(row?.values.roe_minus_coe).toBeNull();
    expect(row?.values.roc).toBe("0.4476");
    expect(result.rejections).toEqual([]);
  });

  it("still rejects the page when a verified column moves", () => {
    const swapped = [...FIXTURE_EVA_HEADERS];
    [swapped[6], swapped[7]] = [swapped[7]!, swapped[6]!];

    expect(
      parse("damodaran.eva-us", fixtureEvaPage({ headers: swapped })),
    ).toEqual({
      ok: false,
      code: "header_mismatch",
    });
  });
});
