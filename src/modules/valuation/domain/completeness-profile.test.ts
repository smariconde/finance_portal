import { describe, expect, it } from "vitest";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  completenessCheck,
  COMPLETENESS_PROFILE_VERSION,
  measureCompleteness,
} from "./completeness-profile";

function value(item: LineItemId, end: string): LineItemValue {
  return {
    item,
    concept: `us-gaap:${item}`,
    value: "1",
    unit: "USD",
    currency: "USD",
    asOf: end,
    observationId: "00000000-0000-4000-8000-000000000001",
    availableAt: "2026-02-01T00:00:00.000Z",
    recordedAt: "2026-02-02T00:00:00.000Z",
    sourceDocumentId: null,
  };
}

function year(end: string, items: readonly LineItemId[]): FiscalYear {
  return {
    fiscalYearEnd: end,
    items: Object.fromEntries(items.map((item) => [item, value(item, end)])),
  };
}

const CORE: LineItemId[] = [
  "revenue",
  "operating_income",
  "income_tax",
  "diluted_shares",
];

const COMPLETE: LineItemId[] = [
  ...CORE,
  "pretax_income",
  "cash",
  "long_term_debt",
  "operating_lease_liability",
  "research_development",
  "capital_expenditure",
  "depreciation_amortization",
];

function series(...years: FiscalYear[]): AnnualFundamentals {
  return { version: "annual-fundamentals-1.0.0", fiscalYears: years };
}

function fiveYears(items: readonly LineItemId[]): AnnualFundamentals {
  return series(
    ...["2025", "2024", "2023", "2022", "2021"].map((y) =>
      year(`${y}-12-31`, items),
    ),
  );
}

describe(COMPLETENESS_PROFILE_VERSION, () => {
  it("meets every check a company can meet today, and names the geographic mix as not ingested", () => {
    const profile = measureCompleteness(fiveYears(COMPLETE), {
      industryMapping: "mapped",
    });

    expect(
      profile.checks
        .filter((item) => item.status !== "met")
        .map((item) => [item.check, item.missing]),
    ).toEqual([
      ["geographic_revenue_mix", ["geographic_revenue_mix.not_ingested"]],
    ]);
    expect(profile.latestFiscalYearEnd).toBe("2025-12-31");
  });

  it("names every structural input the latest year lacks", () => {
    const profile = measureCompleteness(
      series(year("2025-12-31", ["revenue"])),
      {
        industryMapping: null,
      },
    );

    expect(completenessCheck(profile, "structural_inputs")).toMatchObject({
      status: "partial",
      missing: ["operating_income", "income_tax", "diluted_shares"],
      measures: { present: 1, required: 4 },
    });
  });

  it("treats missing fundamentals as missing, never as zero", () => {
    const profile = measureCompleteness(null, { industryMapping: null });

    expect(completenessCheck(profile, "structural_inputs")).toMatchObject({
      status: "missing",
      missing: ["annual_fundamentals"],
    });
    expect(completenessCheck(profile, "history_years")).toMatchObject({
      status: "missing",
      measures: { years: 0 },
    });
  });

  it("counts only consecutive years from the latest", () => {
    const gap = series(
      year("2025-12-31", CORE),
      year("2024-12-31", CORE),
      year("2022-12-31", CORE),
      year("2021-12-31", CORE),
      year("2020-12-31", CORE),
    );
    expect(
      completenessCheck(
        measureCompleteness(gap, { industryMapping: null }),
        "history_years",
      ),
    ).toMatchObject({ status: "missing", measures: { years: 2 } });

    const broken = series(
      year("2025-12-31", CORE),
      year("2024-12-31", CORE),
      year("2023-12-31", CORE),
      year("2022-12-31", ["revenue"]),
      year("2021-12-31", CORE),
    );
    expect(
      completenessCheck(
        measureCompleteness(broken, { industryMapping: null }),
        "history_years",
      ),
    ).toMatchObject({ status: "partial", measures: { years: 3 } });
  });

  it("accepts EBIT reconstructed from pretax income and interest", () => {
    const profile = measureCompleteness(
      series(
        year("2025-12-31", [
          "revenue",
          "pretax_income",
          "interest_expense",
          "income_tax",
          "diluted_shares",
        ]),
      ),
      { industryMapping: null },
    );

    expect(completenessCheck(profile, "structural_inputs").status).toBe("met");
  });

  it("separates research reported with history, too short, and never reported", () => {
    const measure = (items: LineItemId[][]) =>
      completenessCheck(
        measureCompleteness(
          series(
            ...items.map((entry, index) =>
              year(`${2025 - index}-12-31`, entry),
            ),
          ),
          { industryMapping: null },
        ),
        "research_development",
      );

    expect(
      measure([
        ["research_development"],
        ["research_development"],
        ["research_development"],
      ]).status,
    ).toBe("met");
    expect(measure([["research_development"], []])).toMatchObject({
      status: "partial",
      measures: { years: 1 },
    });
    expect(measure([[]])).toMatchObject({
      status: "missing",
      missing: ["research_development.not_reported"],
    });
  });

  it("reports the industry mapping as not evaluated until it exists", () => {
    const profile = (mapping: "mapped" | "ambiguous" | "unmapped" | null) =>
      completenessCheck(
        measureCompleteness(fiveYears(COMPLETE), { industryMapping: mapping }),
        "industry_mapping",
      ).status;

    expect(profile(null)).toBe("not_evaluated");
    expect(profile("mapped")).toBe("met");
    expect(profile("ambiguous")).toBe("partial");
    expect(profile("unmapped")).toBe("missing");
  });

  it("does not count a company without debt facts as debt-free", () => {
    const profile = measureCompleteness(
      series(year("2025-12-31", [...CORE, "cash"])),
      { industryMapping: null },
    );

    expect(completenessCheck(profile, "cash_and_debt")).toMatchObject({
      status: "partial",
      missing: ["debt"],
    });
  });
});
