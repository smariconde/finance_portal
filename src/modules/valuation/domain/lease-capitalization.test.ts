import { describe, expect, it } from "vitest";

import {
  capitalizeOperatingLeases,
  LEASE_CAPITALIZATION_VERSION,
} from "./lease-capitalization";

const base = {
  totalLiability: null,
  currentLiability: null,
  noncurrentLiability: null,
  preTaxCostOfDebt: "0.05",
};

describe("capitalizeOperatingLeases", () => {
  it("treats the reported ASC 842 liability as debt and gives EBIT back its interest", () => {
    expect(
      capitalizeOperatingLeases({ ...base, totalLiability: "12000" }),
    ).toEqual({
      version: LEASE_CAPITALIZATION_VERSION,
      status: "capitalized",
      liabilityBasis: "reported_total",
      leaseDebt: "12000",
      preTaxCostOfDebt: "0.05",
      imputedInterest: "600",
      ebitAdjustment: "600",
      investedCapitalAdjustment: "12000",
      debtAdjustment: "12000",
    });
  });

  it("adds the two parts of the same close when the total is not published", () => {
    expect(
      capitalizeOperatingLeases({
        ...base,
        currentLiability: "1500",
        noncurrentLiability: "8500",
      }),
    ).toMatchObject({
      liabilityBasis: "sum_of_parts",
      leaseDebt: "10000",
      imputedInterest: "500",
    });
  });

  it("prefers the reported total over its parts", () => {
    expect(
      capitalizeOperatingLeases({
        ...base,
        totalLiability: "10001",
        currentLiability: "1500",
        noncurrentLiability: "8500",
      }),
    ).toMatchObject({ liabilityBasis: "reported_total", leaseDebt: "10001" });
  });

  it("does not take one part for the liability", () => {
    expect(
      capitalizeOperatingLeases({ ...base, noncurrentLiability: "8500" }),
    ).toMatchObject({
      status: "not_capitalized",
      reason: "lease_liability_partial",
    });
    expect(
      capitalizeOperatingLeases({ ...base, currentLiability: "1500" }),
    ).toMatchObject({ reason: "lease_liability_partial" });
  });

  it("names a missing liability instead of capitalizing zero", () => {
    expect(capitalizeOperatingLeases(base)).toMatchObject({
      status: "not_capitalized",
      reason: "lease_liability_missing",
    });
  });

  it("capitalizes a reported zero as zero", () => {
    expect(
      capitalizeOperatingLeases({ ...base, totalLiability: "0" }),
    ).toMatchObject({
      status: "capitalized",
      leaseDebt: "0",
      imputedInterest: "0",
    });
  });

  it("rejects a negative liability and a missing cost of debt", () => {
    expect(
      capitalizeOperatingLeases({ ...base, totalLiability: "-1" }),
    ).toMatchObject({ reason: "lease_liability_negative" });
    expect(
      capitalizeOperatingLeases({
        ...base,
        totalLiability: "100",
        preTaxCostOfDebt: null,
      }),
    ).toMatchObject({ reason: "cost_of_debt_missing" });
  });

  it("refuses a non-finite amount as a policy error", () => {
    expect(() =>
      capitalizeOperatingLeases({ ...base, totalLiability: "NaN" }),
    ).toThrow();
  });
});
