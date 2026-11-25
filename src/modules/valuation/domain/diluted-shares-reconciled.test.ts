import { describe, expect, it } from "vitest";

import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  DILUTED_SHARES_RECONCILED_VERSION,
  DILUTED_SHARES_US_GAAP_CONCEPTS,
  reconcileDilutedShares,
} from "./diluted-shares-reconciled";

const CIK = "0000000042";
const FYE = "2025-12-31";

function context(
  id: string,
  start: string,
  end: string,
  member: string | null = null,
  cik = CIK,
): string {
  const segment =
    member === null
      ? ""
      : `<segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:${member}</xbrldi:explicitMember></segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${cik}</identifier>${segment}</entity><period><startDate>${start}</startDate><endDate>${end}</endDate></period></context>`;
}

const CONTEXTS = [
  context("fy", "2025-01-01", FYE),
  context("fy-a", "2025-01-01", FYE, "CommonClassAMember"),
  context("fy-b", "2025-01-01", FYE, "CommonClassBMember"),
  context("fy-c", "2025-01-01", FYE, "CommonClassCMember"),
  context("q4-a", "2025-10-01", FYE, "CommonClassAMember"),
  context("other", "2025-01-01", FYE, null, "0000000099"),
].join("\n");

function filing(facts: string) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
${CONTEXTS}
${facts}
</xbrl>`;
  const read = readXbrlShareFacts(xml, {
    usGaap: DILUTED_SHARES_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") throw new Error("synthetic instance rejected");
  return reconcileDilutedShares(
    {
      accessionNumber: "0000000042-26-000001",
      acceptedAt: "2026-02-10T21:00:00.000Z",
      fiscalYearEnd: FYE,
      read: read.read,
    },
    CIK,
  );
}

const fact = (
  concept: string,
  contextId: string,
  value: string,
  unit: string,
  decimals: string,
) =>
  `<us-gaap:${concept} contextRef="${contextId}" unitRef="${unit}" decimals="${decimals}">${value}</us-gaap:${concept}>`;
const netIncome = (value: string, contextId = "fy") =>
  fact("NetIncomeLoss", contextId, value, "usd", "-6");
const diluted = (contextId: string, value: string) =>
  fact(
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    contextId,
    value,
    "shares",
    "-6",
  );
const eps = (contextId: string, value: string) =>
  fact("EarningsPerShareDiluted", contextId, value, "usdPerShare", "2");

describe(DILUTED_SHARES_RECONCILED_VERSION, () => {
  // Como Visa: toda la utilidad dividida por la clase «as-converted».
  it("takes the one class whose diluted EPS divides the whole net income", () => {
    const result = filing(
      [
        netIncome("1000000000"),
        diluted("fy-a", "80000000"),
        eps("fy-a", "12.50"),
        diluted("fy-c", "3000000"),
        eps("fy-c", "50.00"),
        diluted("q4-a", "79000000"),
        eps("q4-a", "3.20"),
      ].join("\n"),
    );
    expect(result).toEqual({
      status: "reconciled",
      reconciled: {
        version: DILUTED_SHARES_RECONCILED_VERSION,
        basis: "class_diluted",
        member: "CommonClassAMember",
        fiscalYearEnd: FYE,
        shares: "80000000",
        dilutedEps: "12.50",
        netIncome: "1000000000",
        netIncomeConcept: "us-gaap:NetIncomeLoss",
        residual: "0",
        // 0,005 × 80 M + 500.000 × 12,5 + 500.000
        tolerance: "7150000",
        accessionNumber: "0000000042-26-000001",
        availableAt: "2026-02-10T21:00:00.000Z",
      },
    });
  });

  it("admits a residual inside the printed rounding and nothing beyond it", () => {
    // 12,32 × 1.907 M = 23.494,24 M contra 23.504 M: residuo 9,76 M.
    const inside = filing(
      [
        netIncome("23504000000"),
        diluted("fy-a", "1907000000"),
        eps("fy-a", "12.32"),
      ].join("\n"),
    );
    expect(inside).toMatchObject({
      status: "reconciled",
      reconciled: { residual: "9760000", tolerance: "16195000" },
    });
    const outside = filing(
      [
        netIncome("23604000000"),
        diluted("fy-a", "1907000000"),
        eps("fy-a", "12.32"),
      ].join("\n"),
    );
    expect(outside).toEqual({
      status: "unavailable",
      reason: "none_reconciles",
    });
  });

  // Como ExxonMobil: sin diluidas, las básicas concilian el EPS diluido.
  it("takes basic shares when they reconcile the undimensioned diluted EPS", () => {
    const result = filing(
      [
        netIncome("28844000000"),
        fact(
          "WeightedAverageNumberOfSharesOutstandingBasic",
          "fy",
          "4305000000",
          "shares",
          "-6",
        ),
        eps("fy", "6.70"),
      ].join("\n"),
    );
    expect(result).toMatchObject({
      status: "reconciled",
      reconciled: {
        basis: "basic_reconciles_diluted_eps",
        member: null,
        shares: "4305000000",
      },
    });
  });

  it("prefers the diluted income available to common stockholders", () => {
    const result = filing(
      [
        netIncome("1100000000"),
        fact(
          "NetIncomeLossAvailableToCommonStockholdersDiluted",
          "fy",
          "1000000000",
          "usd",
          "-6",
        ),
        diluted("fy", "80000000"),
        eps("fy", "12.50"),
      ].join("\n"),
    );
    expect(result).toMatchObject({
      status: "reconciled",
      reconciled: {
        basis: "undimensioned_diluted",
        netIncomeConcept:
          "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted",
      },
    });
  });

  it("names two reconciling classes instead of choosing or adding them", () => {
    expect(
      filing(
        [
          netIncome("1000000000"),
          diluted("fy-a", "80000000"),
          eps("fy-a", "12.50"),
          diluted("fy-b", "80000000"),
          eps("fy-b", "12.50"),
        ].join("\n"),
      ),
    ).toEqual({ status: "unavailable", reason: "several_reconcile" });
  });

  it("names a filing without net income or without any candidate", () => {
    expect(
      filing([diluted("fy-a", "80000000"), eps("fy-a", "12.50")].join("\n")),
    ).toEqual({ status: "unavailable", reason: "net_income_missing" });
    expect(
      filing([netIncome("1000000000"), diluted("fy-a", "80000000")].join("\n")),
    ).toEqual({ status: "unavailable", reason: "no_candidates" });
  });

  it("reads only the filer's own full fiscal year", () => {
    expect(
      filing(
        [
          netIncome("1000000000", "other"),
          diluted("q4-a", "80000000"),
          eps("q4-a", "12.50"),
        ].join("\n"),
      ),
    ).toEqual({ status: "unavailable", reason: "net_income_missing" });
  });
});
