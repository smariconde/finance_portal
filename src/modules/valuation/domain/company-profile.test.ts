import { describe, expect, it } from "vitest";

import {
  companyProfile,
  COMPANY_PROFILE_VERSION,
  type CompanyProfileInput,
  type ProfileAmount,
} from "./company-profile";

const usd = (value: string): ProfileAmount => ({ value, currency: "USD" });

function input(
  overrides: Partial<CompanyProfileInput> = {},
): CompanyProfileInput {
  return {
    assetProfile: "non_financial_mature",
    currency: "USD",
    fiscalYearEnd: "2025-12-31",
    priceDate: "2026-10-30",
    price: usd("20"),
    shares: "10",
    revenue: usd("100"),
    previousRevenue: usd("80"),
    netIncome: usd("10"),
    ebit: usd("20"),
    depreciation: usd("5"),
    freeCashFlow: usd("15"),
    dividends: usd("5"),
    shareBasedCompensation: usd("2"),
    equity: usd("50"),
    goodwill: usd("5"),
    intangibles: usd("5"),
    cash: usd("10"),
    runwayCash: usd("10"),
    debt: usd("30"),
    evClaims: usd("35"),
    roe: "0.2",
    costOfEquity: "0.1",
    normalizedEarnings: usd("12"),
    normalizedEbitda: usd("30"),
    affo: usd("8"),
    nav: usd("150"),
    ...overrides,
  };
}

function value(result: ReturnType<typeof companyProfile>, key: string) {
  return result.metrics.find((metric) => metric.key === key);
}

describe(COMPANY_PROFILE_VERSION, () => {
  it("uses market equity, claims and cash in distinct mature multiples", () => {
    const result = companyProfile(input());
    expect(result.version).toBe(COMPANY_PROFILE_VERSION);
    expect(value(result, "pe")).toMatchObject({ value: "20", status: "value" });
    expect(value(result, "ev_ebit")).toMatchObject({ value: "11.25" });
    expect(value(result, "fcf_yield")).toMatchObject({ value: "7.5" });
    expect(value(result, "p_fcf")?.value).toMatch(/^13\.333333333/u);
    expect(value(result, "dividend_yield")).toMatchObject({ value: "2.5" });
    expect(value(result, "payout")).toMatchObject({ value: "50" });
    expect(value(result, "net_debt_ebitda")).toMatchObject({ value: "0.8" });
  });

  it("selects growth, loss, cycle, financial and REIT metrics by profile", () => {
    const growth = companyProfile(input({ assetProfile: "high_growth" }));
    expect(value(growth, "ev_sales")).toMatchObject({ value: "2.25" });
    expect(value(growth, "rule_40")).toMatchObject({ value: "40" });
    expect(value(growth, "fcf_margin")).toMatchObject({ value: "15" });
    expect(value(growth, "sbc_sales")).toMatchObject({ value: "2" });

    const loss = companyProfile(
      input({ assetProfile: "loss_making", freeCashFlow: usd("-20") }),
    );
    expect(value(loss, "cash_runway")).toMatchObject({ value: "0.5" });
    expect(
      value(
        companyProfile(input({ assetProfile: "cyclical" })),
        "cycle_ev_ebitda",
      ),
    ).toMatchObject({ value: "7.5" });
    expect(
      value(companyProfile(input({ assetProfile: "bank" })), "ptbv"),
    ).toMatchObject({ value: "5" });
    expect(
      value(companyProfile(input({ assetProfile: "insurer" })), "roe_spread"),
    ).toMatchObject({ value: "10" });
    expect(
      value(companyProfile(input({ assetProfile: "bank" })), "roe"),
    ).toMatchObject({ value: "20" });
    expect(
      value(companyProfile(input({ assetProfile: "bank" })), "cost_of_equity"),
    ).toMatchObject({ value: "10" });
    expect(
      value(companyProfile(input({ assetProfile: "reit" })), "p_nav")?.value,
    ).toMatch(/^1\.333333333/u);
  });

  it("keeps unavailable inputs and zero or negative denominators explicit", () => {
    const missing = companyProfile(input({ dividends: null, priceDate: null }));
    expect(value(missing, "pe")).toMatchObject({
      status: "null",
      reason: "no_comparable_close",
    });
    expect(value(missing, "payout")).toMatchObject({
      status: "null",
      reason: "not_reported",
    });
    const zero = companyProfile(input({ netIncome: usd("0") }));
    expect(value(zero, "pe")).toMatchObject({
      status: "null",
      reason: "non_positive_denominator",
    });
    const negative = companyProfile(input({ netIncome: usd("-1") }));
    expect(value(negative, "pe")).toMatchObject({
      status: "null",
      reason: "non_positive_denominator",
    });
    const noBurn = companyProfile(
      input({ assetProfile: "loss_making", freeCashFlow: usd("1") }),
    );
    expect(value(noBurn, "cash_runway")).toMatchObject({
      status: "null",
      reason: "not_applicable",
    });
  });

  it("rejects currency mismatches and non-finite values", () => {
    const currency = companyProfile(
      input({
        revenue: { value: "100", currency: "EUR" },
        assetProfile: "high_growth",
      }),
    );
    expect(value(currency, "ev_sales")).toMatchObject({
      status: "null",
      reason: "currency_mismatch",
    });
    expect(() => companyProfile(input({ price: usd("NaN") }))).toThrow();
    expect(() => companyProfile(input({ price: usd("Infinity") }))).toThrow();
  });
});
