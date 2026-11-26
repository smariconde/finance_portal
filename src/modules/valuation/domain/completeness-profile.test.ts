import { describe, expect, it } from "vitest";

import type {
  AnnualFundamentals,
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";
import {
  completenessCheck,
  COMPLETENESS_PROFILE_IFRS16_VERSION,
  COMPLETENESS_PROFILE_RECONCILED_SHARES_VERSION,
  COMPLETENESS_PROFILE_VERSION,
  completenessProfileSchema,
  measureCompleteness,
} from "./completeness-profile";
import {
  DILUTED_SHARES_RECONCILED_VERSION,
  type DilutedSharesReconciled,
} from "./diluted-shares-reconciled";

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
  return { version: "annual-fundamentals-1.11.0", fiscalYears: years };
}

function fiveYears(items: readonly LineItemId[]): AnnualFundamentals {
  return series(
    ...["2025", "2024", "2023", "2022", "2021"].map((y) =>
      year(`${y}-12-31`, items),
    ),
  );
}

describe(COMPLETENESS_PROFILE_VERSION, () => {
  it("names the geographic mix as missing while no proposal was accepted", () => {
    const profile = measureCompleteness(fiveYears(COMPLETE), {
      industryMapping: "mapped",
    });

    expect(
      profile.checks
        .filter((item) => item.status !== "met")
        .map((item) => [item.check, item.missing]),
    ).toEqual([
      [
        "geographic_revenue_mix",
        ["geographic_revenue_mix.no_accepted_proposal"],
      ],
    ]);
    expect(profile.latestFiscalYearEnd).toBe("2025-12-31");
  });

  it.each(["owner_declaration", "ai_proposal"] as const)(
    "meets every check with a mix from %s",
    (operationsMix) => {
      const profile = measureCompleteness(fiveYears(COMPLETE), {
        industryMapping: "mapped",
        operationsMix,
      });

      expect(profile.checks.every((item) => item.status === "met")).toBe(true);
    },
  );

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

describe(COMPLETENESS_PROFILE_RECONCILED_SHARES_VERSION, () => {
  const WITHOUT_DILUTED = COMPLETE.filter((item) => item !== "diluted_shares");
  const reconciled = (
    fiscalYearEnd = "2025-12-31",
  ): DilutedSharesReconciled => ({
    version: DILUTED_SHARES_RECONCILED_VERSION,
    basis: "class_diluted",
    member: "CommonClassAMember",
    fiscalYearEnd,
    shares: "80000000",
    dilutedEps: "12.50",
    netIncome: "1000000000",
    netIncomeConcept: "us-gaap:NetIncomeLoss",
    residual: "0",
    tolerance: "7150000",
    accessionNumber: "0000000042-26-000001",
    availableAt: "2026-02-10T21:00:00.000Z",
  });

  it("counts reconciled diluted shares of the latest year and freezes them", () => {
    const profile = measureCompleteness(fiveYears(WITHOUT_DILUTED), {
      industryMapping: "mapped",
      dilutedShares: reconciled(),
    });
    expect(profile.version).toBe(
      COMPLETENESS_PROFILE_RECONCILED_SHARES_VERSION,
    );
    expect(profile.dilutedShares).toEqual(reconciled());
    expect(completenessCheck(profile, "structural_inputs")).toMatchObject({
      status: "met",
      missing: [],
    });
    expect(completenessProfileSchema.parse(profile)).toEqual(profile);
  });

  it("stays 1.3.0 byte for byte when the series has the count or the year differs", () => {
    const withCount = measureCompleteness(fiveYears(COMPLETE), {
      industryMapping: "mapped",
      dilutedShares: reconciled(),
    });
    expect(withCount).toEqual(
      measureCompleteness(fiveYears(COMPLETE), { industryMapping: "mapped" }),
    );
    const otherYear = measureCompleteness(fiveYears(WITHOUT_DILUTED), {
      industryMapping: "mapped",
      dilutedShares: reconciled("2024-12-31"),
    });
    expect(otherYear.version).toBe(COMPLETENESS_PROFILE_VERSION);
    expect(otherYear).not.toHaveProperty("dilutedShares");
    expect(completenessCheck(otherYear, "structural_inputs")).toMatchObject({
      status: "partial",
      missing: ["diluted_shares"],
    });
  });

  it("refuses the frozen count without its version, and the version without it", () => {
    const profile = measureCompleteness(fiveYears(WITHOUT_DILUTED), {
      industryMapping: "mapped",
      dilutedShares: reconciled(),
    });
    expect(
      completenessProfileSchema.safeParse({
        ...profile,
        version: COMPLETENESS_PROFILE_VERSION,
      }).success,
    ).toBe(false);
    const withoutCount = { ...profile, dilutedShares: undefined };
    expect(completenessProfileSchema.safeParse(withoutCount).success).toBe(
      false,
    );
  });
});

describe(COMPLETENESS_PROFILE_IFRS16_VERSION, () => {
  const ifrsLease = (end: string): LineItemValue => ({
    ...value("finance_lease_liability", end),
    concept: "ifrs-full:LeaseLiabilities",
  });
  const withIfrsLease = (years: AnnualFundamentals): AnnualFundamentals => ({
    ...years,
    fiscalYears: years.fiscalYears.map((fiscalYear) => ({
      ...fiscalYear,
      items: {
        ...fiscalYear.items,
        finance_lease_liability: ifrsLease(fiscalYear.fiscalYearEnd),
      },
    })),
  });
  const withoutOperatingLease = COMPLETE.filter(
    (item) => item !== "operating_lease_liability",
  );

  it("meets leases with an IFRS 16 liability and names the version", () => {
    const profile = measureCompleteness(
      withIfrsLease(fiveYears(withoutOperatingLease)),
      { industryMapping: "mapped" },
    );
    expect(profile.version).toBe(COMPLETENESS_PROFILE_IFRS16_VERSION);
    expect(completenessCheck(profile, "leases").status).toBe("met");
    expect(completenessProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("keeps a US finance lease out of the leases check, byte for byte", () => {
    const profile = measureCompleteness(
      fiveYears([...withoutOperatingLease, "finance_lease_liability"]),
      { industryMapping: "mapped" },
    );
    expect(profile.version).toBe(COMPLETENESS_PROFILE_VERSION);
    expect(completenessCheck(profile, "leases").status).toBe("missing");
  });
});
