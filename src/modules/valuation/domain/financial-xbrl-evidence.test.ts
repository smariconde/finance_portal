import { describe, expect, it } from "vitest";

import { readXbrlShareFacts } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import {
  deriveFinancialXbrlEvidence,
  type EarlierAnnualFact,
  FINANCIAL_XBRL_EVIDENCE_VERSION,
  FINANCIAL_XBRL_EXTENSION_CONCEPTS,
  FINANCIAL_XBRL_US_GAAP_CONCEPTS,
} from "./financial-xbrl-evidence";
import { FINANCIAL_PAYOUT_VERSION } from "./financial-payout";

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

type Member = readonly [axis: string, member: string];

function context(
  id: string,
  period: string,
  members: readonly Member[] = [],
): string {
  const segment =
    members.length === 0
      ? ""
      : `<segment>${members
          .map(
            ([axis, member]) =>
              `<xbrldi:explicitMember dimension="us-gaap:${axis}">us-gaap:${member}</xbrldi:explicitMember>`,
          )
          .join("")}</segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier>${segment}</entity><period>${period}</period></context>`;
}

const at = (date: string) => `<instant>${date}</instant>`;
const span = (year: number) =>
  `<startDate>${year}-01-01</startDate><endDate>${year}-12-31</endDate>`;
const CLASS_A: Member = ["StatementClassOfStockAxis", "EquivalentClassAMember"];
const PC: Member = [
  "StatementBusinessSegmentsAxis",
  "PropertyAndCasualtyMember",
];
const component = (member: string): Member => [
  "StatementEquityComponentsAxis",
  member,
];

const CONTEXTS = [
  context("c25", at("2025-12-31")),
  context("c24", at("2024-12-31")),
  context("c23", at("2023-12-31")),
  context("c22", at("2022-12-31")),
  context("y25", span(2025)),
  context("y24", span(2024)),
  context("y23", span(2023)),
  context("y25-a", span(2025), [CLASS_A]),
  context("c25-pc", at("2025-12-31"), [PC]),
  context("c24-pc", at("2024-12-31"), [PC]),
  ...[25, 24, 23, 22].flatMap((year) =>
    [
      "RetainedEarningsMember",
      "AdditionalPaidInCapitalMember",
      "NoncontrollingInterestMember",
      "ParentMember",
    ].map((member) =>
      context(`c${year}-${member}`, at(`20${year}-12-31`), [component(member)]),
    ),
  ),
  context("c25-cet1", at("2025-12-31"), [
    ["ConsolidatedEntitiesAxis", "ParentCompanyMember"],
    [
      "RiskWeightedAssetsCalculationMethodologyAxis",
      "StandardizedApproachMember",
    ],
  ]),
].join("\n");

const fact = (
  concept: string,
  contextId: string,
  value: string,
  unit = "usd",
  decimals = "-6",
) =>
  `<us-gaap:${concept} contextRef="${contextId}" unitRef="${unit}" decimals="${decimals}">${value}</us-gaap:${concept}>`;
const extension = (concept: string, contextId: string, value: string) =>
  `<acme:${concept} contextRef="${contextId}" unitRef="usd" decimals="-6">${value}</acme:${concept}>`;
const M = (millions: number) => `${millions}000000`;

// Con la forma de Berkshire 2025: sin dividendos ni recompras publicados y el
// patrimonio limpio cerrando cada año.
const BERKSHIRE: Record<string, string> = {
  book25: fact("StockholdersEquity", "c25", M(717419)),
  book24: fact("StockholdersEquity", "c24", M(649368)),
  book23: fact("StockholdersEquity", "c23", M(561000)),
  book22: fact("StockholdersEquity", "c22", M(472000)),
  preferred: fact("PreferredStockSharesIssued", "c25", "0", "shares", "0"),
  preferredPrior: fact("PreferredStockSharesIssued", "c24", "0", "shares", "0"),
  income25: fact("NetIncomeLoss", "y25", M(66968)),
  income24: fact("NetIncomeLoss", "y24", M(88995)),
  income23: fact("NetIncomeLoss", "y23", M(96223)),
  eps: fact("EarningsPerShareBasic", "y25-a", "46563", "usdPerShare", "0"),
  shares: fact(
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "y25-a",
    "1438223",
    "shares",
    "0",
  ),
  ci25: fact("ComprehensiveIncomeNetOfTax", "y25", M(68104)),
  ci24: fact("ComprehensiveIncomeNetOfTax", "y24", M(88400)),
  ci23: fact("ComprehensiveIncomeNetOfTax", "y23", M(89100)),
  surplus: fact(
    "StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
    "c25-pc",
    M(333000),
  ),
  reserves: fact(
    "LiabilityForClaimsAndClaimsAdjustmentExpense",
    "c25-pc",
    M(120713),
  ),
};

// Con la forma de GS 2025: preferentes publicadas, utilidad disponible a
// comunes con 55 M que el EPS no explica y un trienio que pasa el 100 %.
const DEALER: Record<string, string> = {
  book25: fact("StockholdersEquity", "c25", M(124972)),
  book24: fact("StockholdersEquity", "c24", M(121996)),
  preferred: fact("PreferredStockValue", "c25", M(15153)),
  preferredPrior: fact("PreferredStockValue", "c24", M(13253)),
  income25: fact(
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "y25",
    M(16300),
  ),
  income24: fact(
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "y24",
    M(13525),
  ),
  income23: fact(
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "y23",
    M(7907),
  ),
  net25: fact("NetIncomeLoss", "y25", M(17176)),
  eps: fact("EarningsPerShareBasic", "y25", "51.95", "usdPerShare", "2"),
  shares: fact(
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "y25",
    "312700000",
    "shares",
    "-5",
  ),
  dividends25: fact("DividendsCommonStock", "y25", M(4424)),
  dividends24: fact("DividendsCommonStock", "y24", M(3801)),
  dividends23: fact("DividendsCommonStock", "y23", M(3591)),
  repurchases25: fact("PaymentsForRepurchaseOfCommonStock", "y25", M(12360)),
  repurchases24: fact("PaymentsForRepurchaseOfCommonStock", "y24", M(8000)),
  repurchases23: fact("PaymentsForRepurchaseOfCommonStock", "y23", M(5796)),
  cet1: fact(
    "CommonEquityTierOneCapitalRatio",
    "c25-cet1",
    "0.143",
    "pure",
    "3",
  ),
  allowance: fact(
    "FinancingReceivableAllowanceForCreditLosses",
    "c25",
    M(2148),
  ),
};

function evidence(
  facts: Record<string, string>,
  options: {
    readonly assetProfile?: "bank" | "insurer" | "broker_dealer";
    readonly earlierFacts?: readonly EarlierAnnualFact[];
  } = {},
) {
  const xml = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:acme="http://acme.example/20251231" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
<unit id="shares"><measure>shares</measure></unit>
<unit id="pure"><measure>pure</measure></unit>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
${CONTEXTS}
${Object.values(facts).join("\n")}
</xbrl>`;
  const read = readXbrlShareFacts(xml, {
    usGaap: FINANCIAL_XBRL_US_GAAP_CONCEPTS,
    extension: FINANCIAL_XBRL_EXTENSION_CONCEPTS,
  });
  if (read.status !== "read") throw new Error("synthetic instance rejected");
  return deriveFinancialXbrlEvidence({
    cik: CIK,
    read: read.read,
    report: REPORT,
    fiscalYearEnd: FYE,
    priorFiscalYearEnd: PRIOR,
    ...options,
  });
}

describe(FINANCIAL_XBRL_EVIDENCE_VERSION, () => {
  it("takes an insurer's parent equity with zero preferred shares and closes clean surplus each year", () => {
    const result = evidence(BERKSHIRE, { assetProfile: "insurer" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const { evidence: found } = result;
    expect(found).toMatchObject({
      version: FINANCIAL_XBRL_EVIDENCE_VERSION,
      fiscalYearEnd: FYE,
      commonBook: { value: M(717419), asOf: FYE },
      priorBook: { value: M(649368), asOf: PRIOR },
      commonIncome: { value: M(66968) },
      commonDividends: {
        value: "0",
        qualityFlags: [
          FINANCIAL_XBRL_EVIDENCE_VERSION,
          "zero_by_clean_surplus",
        ],
      },
      netRepurchases: { value: "0" },
      payout: "0",
      payoutBasis: {
        version: FINANCIAL_PAYOUT_VERSION,
        ratio: "0",
        payoutCapped: false,
      },
      sourceDocumentId: REPORT.accessionNumber,
      availableAt: REPORT.acceptedAt,
    });
    expect(found.commonBook.qualityFlags).toContain("preferred_shares_zero");
    expect(found.commonIncome.qualityFlags).toContain("NetIncomeLoss");
    expect(found.payoutBasis?.years.map((year) => year.fiscalYearEnd)).toEqual([
      "2025-12-31",
      "2024-12-31",
      "2023-12-31",
    ]);
    expect(found.regulatoryCapital).toContain("USD 333000 millones");
    expect(found.regulatoryCapital).toContain("consolidado del grupo");
    expect(found.assetQuality).toContain("USD 120713 millones");
  });

  it("never reads absent preferred stock as zero", () => {
    expect(evidence({ ...BERKSHIRE, preferred: "" })).toEqual({
      status: "unavailable",
      reason: "preferred_not_evidenced",
    });
    expect(evidence({ ...DEALER, preferredPrior: "" })).toEqual({
      status: "unavailable",
      reason: "preferred_not_evidenced",
    });
  });

  it("subtracts preferred stock at both closes and needs income available to common", () => {
    const result = evidence(DEALER, { assetProfile: "broker_dealer" });
    expect(result).toMatchObject({
      status: "ready",
      evidence: {
        commonBook: { value: M(124972 - 15153) },
        priorBook: { value: M(121996 - 13253) },
        commonIncome: { value: M(16300) },
      },
    });
    // Con preferentes, la utilidad neta total nunca es la común.
    expect(
      evidence(
        { ...DEALER, income25: "", income24: "", income23: "" },
        { assetProfile: "broker_dealer" },
      ),
    ).toEqual({ status: "unavailable", reason: "earnings_bridge_mismatch" });
  });

  it("reads preferred stock from the filer's extension under the us-gaap name", () => {
    const result = evidence(
      {
        ...DEALER,
        preferred: extension("PreferredStockCarryingValue", "c25", M(15153)),
        preferredPrior: extension(
          "PreferredStockCarryingValue",
          "c24",
          M(13253),
        ),
      },
      { assetProfile: "broker_dealer" },
    );
    expect(result).toMatchObject({
      status: "ready",
      evidence: { commonBook: { value: M(124972 - 15153) } },
    });
    if (result.status !== "ready") return;
    expect(result.evidence.commonBook.qualityFlags).toContain(
      "preferred_filer_extension",
    );
  });

  it("names an EPS gap within 1 % and refuses a larger one", () => {
    const result = evidence(DEALER, { assetProfile: "broker_dealer" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.evidence.commonIncome.qualityFlags).toContain(
      "participating_allocation_unpublished",
    );
    expect(result.evidence.cleanSurplus).toContain("USD 55.2 millones");
    expect(
      evidence(
        {
          ...DEALER,
          eps: fact(
            "EarningsPerShareBasic",
            "y25",
            "50.00",
            "usdPerShare",
            "2",
          ),
        },
        { assetProfile: "broker_dealer" },
      ),
    ).toEqual({ status: "unavailable", reason: "earnings_bridge_mismatch" });
    expect(
      evidence(
        {
          ...BERKSHIRE,
          eps: fact(
            "EarningsPerShareBasic",
            "y25-a",
            "45000",
            "usdPerShare",
            "0",
          ),
        },
        { assetProfile: "insurer" },
      ),
    ).toEqual({ status: "unavailable", reason: "earnings_bridge_mismatch" });
  });

  it("caps a three-year payout above one and keeps the ratio it came from", () => {
    const result = evidence(DEALER, { assetProfile: "broker_dealer" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const { payoutBasis } = result.evidence;
    // (4.424 + 3.801 + 3.591 + 12.360 + 8.000 + 5.796) / (16.300 + 13.525 + 7.907)
    expect(payoutBasis?.payoutCapped).toBe(true);
    expect(payoutBasis?.ratio.startsWith("1.0063")).toBe(true);
    expect(result.evidence.payout).toBe("1");
    expect(result.evidence.commonDividends.value).toBe(M(4424));
    expect(result.evidence.netRepurchases.value).toBe(M(12360));
    expect(result.evidence.cleanSurplus).toContain("llevado a 100 %");
  });

  it("asks for a year a used concept no longer carries, and reads it only from an earlier 10-K", () => {
    const missing = { ...DEALER, repurchases23: "" };
    expect(evidence(missing, { assetProfile: "broker_dealer" })).toEqual({
      status: "unavailable",
      reason: "payout_year_unpublished",
      concept: "us-gaap:PaymentsForRepurchaseOfCommonStock",
    });
    const point = (
      overrides: Partial<EarlierAnnualFact> = {},
    ): EarlierAnnualFact => ({
      concept: "PaymentsForRepurchaseOfCommonStock",
      unit: "USD",
      start: "2023-01-01",
      end: "2023-12-31",
      value: M(5796),
      accessionNumber: "0000000042-25-000007",
      form: "10-K",
      filed: "2025-02-20",
      ...overrides,
    });
    const found = evidence(missing, {
      assetProfile: "broker_dealer",
      earlierFacts: [point()],
    });
    expect(found.status).toBe("ready");
    if (found.status !== "ready") return;
    expect(found.evidence.payoutBasis?.years[2]?.netRepurchases).toBe(M(5796));
    expect(found.evidence.cleanSurplus).toContain("10-K 0000000042-25-000007");
    // Un punto presentado después del 10-K que se valúa no existe al corte.
    expect(
      evidence(missing, {
        assetProfile: "broker_dealer",
        earlierFacts: [point({ filed: "2026-03-05" })],
      }),
    ).toEqual({ status: "unavailable", reason: "distribution_unsupported" });
    expect(
      evidence(missing, {
        assetProfile: "broker_dealer",
        earlierFacts: [point({ form: "10-Q" })],
      }),
    ).toEqual({ status: "unavailable", reason: "distribution_unsupported" });
  });

  it("takes unpublished dividends as zero when retained earnings roll exactly with income", () => {
    const rolling = {
      ...DEALER,
      preferred: fact("PreferredStockValue", "c25", "0"),
      preferredPrior: fact("PreferredStockValue", "c24", "0"),
      income25: fact("NetIncomeLoss", "y25", M(16300)),
      income24: fact("NetIncomeLoss", "y24", M(13525)),
      income23: fact("NetIncomeLoss", "y23", M(7907)),
      net25: "",
      eps: fact("EarningsPerShareBasic", "y25", "52.13", "usdPerShare", "2"),
      dividends25: "",
      dividends24: "",
      dividends23: "",
      re25: fact("StockholdersEquity", "c25-RetainedEarningsMember", M(40000)),
      re24: fact("StockholdersEquity", "c24-RetainedEarningsMember", M(23700)),
      re23: fact("StockholdersEquity", "c23-RetainedEarningsMember", M(10175)),
      re22: fact("StockholdersEquity", "c22-RetainedEarningsMember", M(2268)),
    };
    const result = evidence(rolling, { assetProfile: "broker_dealer" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.evidence.commonDividends.qualityFlags).toContain(
      "zero_by_retained_earnings_roll",
    );
    // Un resultado acumulado que no rueda con la utilidad no prueba nada.
    expect(
      evidence(
        {
          ...rolling,
          re25: fact(
            "StockholdersEquity",
            "c25-RetainedEarningsMember",
            M(39000),
          ),
        },
        { assetProfile: "broker_dealer" },
      ),
    ).toEqual({ status: "unavailable", reason: "distribution_unsupported" });
  });

  it("takes parent equity as the total less noncontrolling interests, and zero preferred from the components", () => {
    const upC = {
      ...BERKSHIRE,
      book25: [
        fact(
          "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
          "c25",
          M(717430),
        ),
        fact("MinorityInterest", "c25", M(11)),
      ].join("\n"),
      preferred: [
        fact("StockholdersEquity", "c25-RetainedEarningsMember", M(700000)),
        fact(
          "StockholdersEquity",
          "c25-AdditionalPaidInCapitalMember",
          M(17419),
        ),
        fact("StockholdersEquity", "c25-NoncontrollingInterestMember", M(11)),
      ].join("\n"),
    };
    const result = evidence(upC, { assetProfile: "insurer" });
    expect(result).toMatchObject({
      status: "ready",
      evidence: { commonBook: { value: M(717419) } },
    });
    if (result.status !== "ready") return;
    expect(result.evidence.commonBook.qualityFlags).toEqual([
      FINANCIAL_XBRL_EVIDENCE_VERSION,
      "parent_equity_total_less_nci",
      "preferred_components",
    ]);
    // Componentes que no suman la controlante no prueban preferentes en cero.
    expect(
      evidence(
        {
          ...upC,
          preferred: fact(
            "StockholdersEquity",
            "c25-RetainedEarningsMember",
            M(700000),
          ),
        },
        { assetProfile: "insurer" },
      ),
    ).toEqual({ status: "unavailable", reason: "preferred_not_evidenced" });
  });

  it("requires the diagnostics of a bank or insurer and names their absence for a broker-dealer", () => {
    expect(
      evidence({ ...BERKSHIRE, surplus: "" }, { assetProfile: "insurer" }),
    ).toEqual({
      status: "unavailable",
      reason: "regulatory_capital_missing",
    });
    expect(
      evidence({ ...BERKSHIRE, reserves: "" }, { assetProfile: "insurer" }),
    ).toEqual({
      status: "unavailable",
      reason: "asset_quality_missing",
    });
    const named = evidence(
      { ...DEALER, cet1: "", allowance: "" },
      { assetProfile: "broker_dealer" },
    );
    expect(named.status).toBe("ready");
    if (named.status !== "ready") return;
    expect(named.evidence.regulatoryCapital).toContain("no se contrasta");
    expect(named.evidence.assetQuality).toContain("no se contrasta");
    expect(evidence({ ...DEALER, cet1: "" }, { assetProfile: "bank" })).toEqual(
      { status: "unavailable", reason: "regulatory_capital_missing" },
    );
  });

  it("reads a CET1 ratio published on two axes", () => {
    const result = evidence(DEALER, { assetProfile: "broker_dealer" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.evidence.regulatoryCapital).toContain(
      "14.3 % (ParentCompanyMember · StandardizedApproachMember)",
    );
  });

  it("needs three fiscal years and both closes", () => {
    expect(
      evidence({ ...BERKSHIRE, income23: "" }, { assetProfile: "insurer" }),
    ).toEqual({ status: "unavailable", reason: "payout_history_missing" });
    expect(
      evidence({ ...BERKSHIRE, book24: "" }, { assetProfile: "insurer" }),
    ).toEqual({ status: "unavailable", reason: "common_equity_missing" });
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
