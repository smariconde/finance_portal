import { describe, expect, it } from "vitest";

import { readXbrlInstance } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import type { FiscalYear, LineItemValue } from "./annual-fundamentals";
import {
  captiveCoverage,
  deriveCaptiveFinanceSplit,
  financeDebtOf,
  industrialDebtOf,
  listCaptiveFinanceFacts,
  type CaptiveFinanceFiling,
} from "./captive-finance";
import {
  declaredCaptiveFinance,
  DECLARED_CAPTIVE_FINANCE,
  type CaptiveFinanceDeclaration,
} from "./declared-captive-finance";

const CAT = declaredCaptiveFinance("0000018230")!;
const FY = "2025-12-31";
const ACCEPTED = "2026-02-13T21:10:00.000Z";

type Fact = readonly [concept: string, context: string, value: string];

/** Un instance sintético con el miembro industrial, el del interés y la financiera. */
function filing(
  facts: readonly Fact[],
  overrides: Partial<CaptiveFinanceFiling> = {},
): CaptiveFinanceFiling {
  const member = (id: string, period: string, local: string | null) =>
    `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CAT.cik}</identifier>${
      local === null
        ? ""
        : `<segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">cat:${local}</xbrldi:explicitMember></segment>`
    }</entity><period>${period}</period></context>`;
  const xml = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:cat="http://www.cat.example/2025" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
${member("all", `<instant>${FY}</instant>`, null)}
${member("ind", `<instant>${FY}</instant>`, "MachineryPowerEnergyMember")}
${member("fin", `<instant>${FY}</instant>`, "FinancialProductsMember")}
${member("int", `<startDate>2025-01-01</startDate><endDate>${FY}</endDate>`, "AllOtherExcludingFinancialProductsMember")}
${facts
  .map(
    ([concept, context, value]) =>
      `<us-gaap:${concept} contextRef="${context}" unitRef="usd">${value}</us-gaap:${concept}>`,
  )
  .join("\n")}
</xbrl>`;
  const read = readXbrlInstance(xml);
  if (read.status !== "read") throw new Error(read.reason);

  return {
    accessionNumber: "0000018230-26-000008",
    acceptedAt: ACCEPTED,
    reportDate: FY,
    instance: read.instance,
    ...overrides,
  };
}

const SPLIT_FACTS: readonly Fact[] = [
  ["LongTermDebtNoncurrent", "all", "30696000000"],
  ["ShortTermBorrowings", "all", "5514000000"],
  ["LongTermDebtAndCapitalLeaseObligations", "ind", "10678000000"],
  ["LongTermDebtAndCapitalLeaseObligationsCurrent", "ind", "35000000"],
  ["ShortTermBorrowings", "ind", "0"],
  ["LongTermDebtAndCapitalLeaseObligations", "fin", "20018000000"],
  ["LongTermDebtAndCapitalLeaseObligationsCurrent", "fin", "7085000000"],
  ["ShortTermBorrowings", "fin", "5514000000"],
  ["InterestExpenseNonoperating", "int", "502000000"],
];

function lineItem(
  item: LineItemValue["item"],
  concept: string,
  value: string,
): LineItemValue {
  return {
    item,
    concept,
    value,
    unit: "USD",
    currency: "USD",
    asOf: FY,
    observationId: `00000000-0000-4000-8000-00000000000${item.length % 10}`,
    availableAt: ACCEPTED,
    recordedAt: ACCEPTED,
    sourceDocumentId: "0000018230-26-000008",
  };
}

const BASE_YEAR: FiscalYear = {
  fiscalYearEnd: FY,
  items: {
    operating_income: lineItem(
      "operating_income",
      "us-gaap:OperatingIncomeLoss",
      "11151000000",
    ),
    pretax_income: lineItem(
      "pretax_income",
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      "11541000000",
    ),
  },
};

function derive(
  facts: readonly Fact[] = SPLIT_FACTS,
  options: {
    declaration?: CaptiveFinanceDeclaration;
    filing?: CaptiveFinanceFiling | null;
    baseYear?: FiscalYear;
  } = {},
) {
  return deriveCaptiveFinanceSplit({
    declaration: options.declaration ?? CAT,
    filing: options.filing === undefined ? filing(facts) : options.filing,
    baseYear: options.baseYear ?? BASE_YEAR,
    sourceId: "sec-edgar",
  });
}

describe("captive-finance-split-1.0.0", () => {
  it("subtracts the industrial debt the recipes close on the industrial member", () => {
    const result = derive();
    if (result.status !== "split") throw new Error(result.reason);

    const debt = industrialDebtOf(result.split);
    expect(debt).toMatchObject({
      status: "resolved",
      recipe: "noncurrent_plus_current_maturities",
      total: "10713000000",
    });
    expect(financeDebtOf(result.split)).toMatchObject({
      status: "resolved",
      total: "32617000000",
    });
    expect(result.split.industrialDebt.longTermNoncurrent).toMatchObject({
      concept: "us-gaap:LongTermDebtAndCapitalLeaseObligations",
      asOf: FY,
      availableAt: ACCEPTED,
      sourceDocumentId: "0000018230-26-000008",
      qualityFlags: ["xbrl_member:MachineryPowerEnergyMember"],
    });
    expect(result.split.industrialInterest).toMatchObject({
      basis: "gross",
      facts: [
        {
          concept: "us-gaap:InterestExpenseNonoperating",
          value: "502000000",
          qualityFlags: [
            "xbrl_member:AllOtherExcludingFinancialProductsMember",
          ],
        },
      ],
    });
  });

  it("covers EBIT with the industrial interest of the same fiscal year", () => {
    const result = derive();
    if (result.status !== "split") throw new Error(result.reason);

    expect(
      captiveCoverage(result.split, BASE_YEAR.items.operating_income!),
    ).toEqual({
      value: expect.stringMatching(/^22\.21314741/u),
      fiscalYearEnd: FY,
      fromLatestFiscalYear: true,
      availableAt: ACCEPTED,
      interestBasis: "captive_industrial",
    });
  });

  it("lists every frozen fact with its path", () => {
    const result = derive();
    if (result.status !== "split") throw new Error(result.reason);

    expect(
      listCaptiveFinanceFacts(result.split, "facts").map((entry) => entry.path),
    ).toEqual([
      "facts.industrialDebt.longTermNoncurrent",
      "facts.industrialDebt.longTermCurrent",
      "facts.industrialDebt.shortTermBorrowings",
      "facts.financeDebt.longTermNoncurrent",
      "facts.financeDebt.longTermCurrent",
      "facts.financeDebt.shortTermBorrowings",
      "facts.industrialInterest.facts.0",
    ]);
  });

  it("names an issuer whose split is not tagged", () => {
    const deere = DECLARED_CAPTIVE_FINANCE.find(
      (declaration) => declaration.segments === null,
    )!;

    expect(derive(SPLIT_FACTS, { declaration: deere })).toMatchObject({
      status: "unavailable",
      reason: "split_not_tagged",
    });
  });

  it("never falls back to consolidated debt without the filing of the base year", () => {
    expect(derive(SPLIT_FACTS, { filing: null })).toMatchObject({
      status: "unavailable",
      reason: "filing_unavailable",
    });
    expect(
      derive(SPLIT_FACTS, {
        filing: filing(SPLIT_FACTS, { reportDate: "2024-12-31" }),
      }),
    ).toMatchObject({ status: "unavailable", reason: "filing_unavailable" });
  });

  it("names an industrial balance with no recipe, never zero", () => {
    // Sin vencimientos corrientes ninguna receta cierra, aunque la no
    // corriente esté: como CAT consolidada.
    expect(
      derive(
        SPLIT_FACTS.filter(
          ([concept, context]) =>
            !(context === "ind" && concept.endsWith("Current")),
        ),
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "industrial_debt_unresolved",
    });
    expect(
      derive(SPLIT_FACTS.filter(([, context]) => context !== "ind")),
    ).toMatchObject({
      status: "unavailable",
      reason: "industrial_debt_unresolved",
    });
  });

  it("names a missing industrial interest instead of using the consolidated one", () => {
    expect(
      derive(SPLIT_FACTS.filter(([, context]) => context !== "int")),
    ).toMatchObject({
      status: "unavailable",
      reason: "industrial_interest_missing",
    });
    expect(
      derive([
        ...SPLIT_FACTS.filter(([, context]) => context !== "int"),
        ["InterestExpenseNonoperating", "int", "0"],
      ]),
    ).toMatchObject({ reason: "industrial_interest_missing" });
  });

  it("refuses an EBIT derived from pretax income", () => {
    expect(
      derive(SPLIT_FACTS, {
        baseYear: {
          fiscalYearEnd: FY,
          items: { pretax_income: BASE_YEAR.items.pretax_income! },
        },
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "ebit_derived_from_pretax",
    });
  });

  it("declares every issuer once, with a ten-digit CIK", () => {
    const ciks = DECLARED_CAPTIVE_FINANCE.map((declaration) => declaration.cik);

    expect(new Set(ciks).size).toBe(ciks.length);
    expect(ciks.every((cik) => /^[0-9]{10}$/u.test(cik))).toBe(true);
    expect(declaredCaptiveFinance(null)).toBeNull();
    expect(declaredCaptiveFinance("0000320193")).toBeNull();
  });
});
