import { describe, expect, it } from "vitest";

import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { parseDecimal } from "./decimal-policy";
import {
  deriveReitAssumptions,
  isEquityPropertyShare,
  reitPropertyShare,
} from "./derived-reit";
import type { DerivedReit } from "./reit-input";

const shared = fixtureFinancialValuation();
const money = (value: string) => ({
  ...shared.commonBookEquity!,
  value,
});

function derived(overrides: Partial<DerivedReit> = {}): DerivedReit {
  return {
    version: "derived-reit-1.0.0",
    affoBasis: {
      commonNetIncome:
        "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
      realEstateDepreciation: "us-gaap:DepreciationAndAmortization",
      propertySaleGains: null,
      realEstateImpairments: null,
      jointVentureAdjustment: null,
      recurringCapex: null,
      straightLineRent: null,
    },
    propertyShare: {
      realEstatePropertyNet: money("150"),
      assets: money("200"),
      share: "0.75",
    },
    revenueHistory: [
      { fiscalYearEnd: "2024-12-31", value: "24" },
      { fiscalYearEnd: "2023-12-31", value: "22" },
      { fiscalYearEnd: "2022-12-31", value: "20" },
    ],
    commonEquity: money("100"),
    commonEquityBasis: "common_equity",
    equityBeta: { ...shared.risk.riskFree!, value: "0.8" },
    ...overrides,
  };
}

const affo = (value: string) => parseDecimal(value, "affo");

describe("derived-reit-1.0.0", () => {
  it("caps the starting growth at what retained AFFO can fund", () => {
    const assumptions = deriveReitAssumptions(shared, derived(), affo("10"));
    expect(assumptions?.periods[0]?.affoGrowth).toBe("0.03");
    expect(assumptions?.periods[0]?.returnOnNewEquity).toBe("0.1");
    expect(assumptions?.periods[0]?.equityBeta).toBe("0.8");
    expect(assumptions?.terminal.equityBeta).toBe("1");
    expect(assumptions?.terminal.growth).toBe(shared.risk.riskFree!.value);
    expect(assumptions?.nav).toBeNull();
  });

  it("floors a shrinking revenue trend at zero growth", () => {
    const shrinking = derived({
      revenueHistory: [
        { fiscalYearEnd: "2024-12-31", value: "18" },
        { fiscalYearEnd: "2023-12-31", value: "20" },
        { fiscalYearEnd: "2022-12-31", value: "22" },
      ],
    });
    expect(
      deriveReitAssumptions(shared, shrinking, affo("10"))?.periods[0]
        ?.affoGrowth,
    ).toBe("0");
  });

  it("does not derive from nonpositive AFFO, nonpositive equity or a short history", () => {
    expect(deriveReitAssumptions(shared, derived(), affo("0"))).toBeNull();
    expect(deriveReitAssumptions(shared, derived(), affo("-1"))).toBeNull();
    expect(
      deriveReitAssumptions(
        shared,
        derived({ commonEquity: money("0") }),
        affo("10"),
      ),
    ).toBeNull();
    expect(
      deriveReitAssumptions(
        shared,
        derived({ revenueHistory: derived().revenueHistory.slice(0, 2) }),
        affo("10"),
      ),
    ).toBeNull();
    expect(
      deriveReitAssumptions(
        { risk: { ...shared.risk, riskFree: null } },
        derived(),
        affo("10"),
      ),
    ).toBeNull();
  });

  it("measures the property basis and refuses a nonpositive total", () => {
    expect(reitPropertyShare("150", "200")?.toString()).toBe("0.75");
    expect(isEquityPropertyShare(reitPropertyShare("100", "200")!)).toBe(true);
    expect(isEquityPropertyShare(reitPropertyShare("99", "200")!)).toBe(false);
    expect(reitPropertyShare("10", "0")).toBeNull();
    expect(reitPropertyShare("-1", "200")).toBeNull();
  });
});
