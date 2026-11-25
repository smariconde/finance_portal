import { describe, expect, it } from "vitest";

import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  deriveFinancialXbrlEvidence,
  FINANCIAL_XBRL_EVIDENCE_VERSION,
  FINANCIAL_XBRL_US_GAAP_CONCEPTS,
} from "./financial-xbrl-evidence";

const CIK = "0000000042";
const FYE = "2025-12-31";
const PRIOR = "2024-12-31";
const REPORT = {
  cik: CIK,
  accessionNumber: "0000000042-26-000010",
  acceptedAt: "2026-03-02T11:02:28.000Z",
  reportDate: FYE,
  primaryDocument: "acme-20251231.htm",
  url: "https://www.sec.gov/Archives/edgar/data/42/000000004226000010/acme-20251231.htm",
};

function context(
  id: string,
  period: string,
  member: readonly [string, string] | null = null,
): string {
  const segment =
    member === null
      ? ""
      : `<segment><xbrldi:explicitMember dimension="us-gaap:${member[0]}">us-gaap:${member[1]}</xbrldi:explicitMember></segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier>${segment}</entity><period>${period}</period></context>`;
}

const at = (date: string) => `<instant>${date}</instant>`;
const year = `<startDate>2025-01-01</startDate><endDate>${FYE}</endDate>`;
const CLASS_A = [
  "StatementClassOfStockAxis",
  "EquivalentClassAMember",
] as const;
const PC = [
  "StatementBusinessSegmentsAxis",
  "PropertyAndCasualtyMember",
] as const;

const CONTEXTS = [
  context("close", at(FYE)),
  context("prior", at(PRIOR)),
  context("fy", year),
  context("fy-a", year, CLASS_A),
  context("close-pc", at(FYE), PC),
  context("prior-pc", at(PRIOR), PC),
].join("\n");

const fact = (
  concept: string,
  contextId: string,
  value: string,
  unit = "usd",
  decimals = "-6",
) =>
  `<us-gaap:${concept} contextRef="${contextId}" unitRef="${unit}" decimals="${decimals}">${value}</us-gaap:${concept}>`;

// Con la forma de Berkshire 2025: sin dividendos ni recompras.
const BASE = {
  book: fact("StockholdersEquity", "close", "717419000000"),
  prior: fact("StockholdersEquity", "prior", "649368000000"),
  preferred: fact("PreferredStockSharesIssued", "close", "0", "shares", "0"),
  income: fact("NetIncomeLoss", "fy", "66968000000"),
  eps: fact("EarningsPerShareBasic", "fy-a", "46563", "usdPerShare", "0"),
  shares: fact(
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "fy-a",
    "1438223",
    "shares",
    "0",
  ),
  comprehensive: fact("ComprehensiveIncomeNetOfTax", "fy", "68104000000"),
  surplus: fact(
    "StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
    "close-pc",
    "333000000000",
  ),
  reserves: fact(
    "LiabilityForClaimsAndClaimsAdjustmentExpense",
    "close-pc",
    "120713000000",
  ),
};

function evidence(overrides: Partial<Record<keyof typeof BASE, string>> = {}) {
  const facts = Object.values({ ...BASE, ...overrides }).join("\n");
  const xml = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
${CONTEXTS}
${facts}
</xbrl>`;
  const read = readXbrlShareFacts(xml, {
    usGaap: FINANCIAL_XBRL_US_GAAP_CONCEPTS,
    extension: [],
  });
  if (read.status !== "read") throw new Error("synthetic instance rejected");
  return deriveFinancialXbrlEvidence({
    cik: CIK,
    read: read.read,
    report: REPORT,
    fiscalYearEnd: FYE,
    priorFiscalYearEnd: PRIOR,
  });
}

describe(FINANCIAL_XBRL_EVIDENCE_VERSION, () => {
  it("takes parent equity and income with published zero preferred and a reconciling EPS", () => {
    const result = evidence();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const { evidence: found } = result;
    expect(found).toMatchObject({
      version: FINANCIAL_XBRL_EVIDENCE_VERSION,
      fiscalYearEnd: FYE,
      commonBook: { value: "717419000000", asOf: FYE },
      priorBook: { value: "649368000000", asOf: PRIOR },
      commonIncome: { value: "66968000000" },
      commonDividends: {
        value: "0",
        qualityFlags: [
          FINANCIAL_XBRL_EVIDENCE_VERSION,
          "zero_by_clean_surplus",
        ],
      },
      netRepurchases: { value: "0" },
      payout: "0",
      sourceDocumentId: REPORT.accessionNumber,
      availableAt: REPORT.acceptedAt,
    });
    expect(found.regulatoryCapital).toContain("USD 333000 millones");
    expect(found.regulatoryCapital).toContain("consolidado del grupo");
    expect(found.assetQuality).toContain("USD 120713 millones");
    expect(found.cleanSurplus).toContain("USD -53 millones");
  });

  it("never reads absent preferred stock as zero, nor outstanding preferred as common", () => {
    expect(evidence({ preferred: "" })).toEqual({
      status: "unavailable",
      reason: "preferred_not_evidenced",
    });
    expect(
      evidence({
        preferred: fact("PreferredStockValue", "close", "5000000000"),
      }),
    ).toEqual({ status: "unavailable", reason: "preferred_outstanding" });
  });

  it("refuses income that no basic EPS reproduces", () => {
    expect(
      evidence({
        eps: fact("EarningsPerShareBasic", "fy-a", "45000", "usdPerShare", "0"),
      }),
    ).toEqual({ status: "unavailable", reason: "earnings_bridge_mismatch" });
  });

  it("takes an unpublished distribution as zero only when clean surplus closes", () => {
    // Un dividendo de 5.000 M que no se publicó deja un residuo de 5 % de la utilidad.
    expect(
      evidence({
        book: fact("StockholdersEquity", "close", "712419000000"),
      }),
    ).toEqual({ status: "unavailable", reason: "distribution_unsupported" });
    const published = evidence({
      book: fact("StockholdersEquity", "close", "712419000000"),
      comprehensive: [
        BASE.comprehensive,
        fact("PaymentsOfDividendsCommonStock", "fy", "5000000000"),
        fact("PaymentsForRepurchaseOfCommonStock", "fy", "0"),
      ].join("\n"),
    });
    expect(published).toMatchObject({
      status: "ready",
      evidence: {
        commonDividends: {
          value: "5000000000",
          qualityFlags: [FINANCIAL_XBRL_EVIDENCE_VERSION],
        },
      },
    });
  });

  it("needs the dated diagnostics and both closes", () => {
    expect(evidence({ surplus: "" })).toEqual({
      status: "unavailable",
      reason: "regulatory_capital_missing",
    });
    expect(evidence({ reserves: "" })).toEqual({
      status: "unavailable",
      reason: "asset_quality_missing",
    });
    expect(evidence({ prior: "" })).toEqual({
      status: "unavailable",
      reason: "common_equity_missing",
    });
  });

  it("reads only the 10-K of the requested fiscal year", () => {
    const read = readXbrlShareFacts(
      '<xbrl xmlns="http://www.xbrl.org/2003/instance">' + CONTEXTS + "</xbrl>",
      {
        usGaap: FINANCIAL_XBRL_US_GAAP_CONCEPTS,
        extension: [],
      },
    );
    if (read.status !== "read") throw new Error("rejected");
    expect(
      deriveFinancialXbrlEvidence({
        cik: CIK,
        read: read.read,
        report: { ...REPORT, reportDate: PRIOR },
        fiscalYearEnd: FYE,
        priorFiscalYearEnd: PRIOR,
      }),
    ).toEqual({ status: "unavailable", reason: "filing_year_mismatch" });
  });
});
