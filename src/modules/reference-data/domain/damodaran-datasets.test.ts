import { describe, expect, it } from "vitest";

import {
  FIXTURE_BETA_HEADERS,
  fixtureBetaRows,
  fixtureBetasPage,
  fixtureCountryRiskPage,
  fixtureImpliedErpPage,
  fixtureRatingsPage,
} from "../infrastructure/fixture-damodaran-pages";
import {
  findDamodaranDataset,
  parseDamodaranDataset,
  percentToFraction,
  rowKeyOf,
} from "./damodaran-datasets";

function parse(datasetId: string, html: string) {
  return parseDamodaranDataset(findDamodaranDataset(datasetId)!, html);
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

describe("damodaran-html-1.0.0: country risk, implied ERP and ratings", () => {
  it("reads the country table after the link table and keeps the update note in the label", () => {
    const result = parse("damodaran.country-risk", fixtureCountryRiskPage());
    if (!result.ok) throw new Error(result.code);

    expect(result.publishedLabel).toBe("January 5, 2026");
    expect(result.rows.find((row) => row.key === "turkey")).toMatchObject({
      label: "Turkey (updated February 2026)",
      values: { moodys_rating: "Ba3", country_risk_premium: "0.0466" },
    });
    expect(
      result.rows.find((row) => row.key === "united-states")?.values
        .sovereign_cds,
    ).toBeNull();
  });

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
