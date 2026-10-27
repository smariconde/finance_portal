import { describe, expect, it } from "vitest";

import type { AnnualFundamentals } from "./annual-fundamentals";
import { buildCapitalization } from "./capitalization-bridge";
import {
  buildNormalization,
  EQUITY_INCLUDING_MINORITY,
  listNormalizationFacts,
  normalizationFactsFromSeries,
  normalizationMismatches,
  type ConceptFact,
  type NormalizationContext,
  type NormalizationFacts,
} from "./normalization";
import type { MonetaryFact } from "./valuation-facts";
import { zeroDebtEvidenceFixture } from "../infrastructure/zero-debt-evidence-fixtures";

const BASE = "2025-12-31";
const ENDS = [BASE, "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"];

function money(value: string, asOf = BASE): MonetaryFact {
  return {
    value,
    currency: "USD",
    unit: "monetary",
    asOf,
    availableAt: "2026-02-15T21:00:00.000Z",
    sourceId: "sec-edgar",
    sourceDocumentId: "0000000000-26-000001",
    observationId: null,
    qualityFlags: [],
  };
}

function fact(value: string, concept: string, asOf = BASE): ConceptFact {
  return { ...money(value, asOf), concept: `us-gaap:${concept}` };
}

/** EBIT 1.000 y arrendamientos de 200 al 5 %: EBIT capitalizado 1.010. */
const CAPITALIZATION = buildCapitalization(
  {
    baseFiscalYearEnd: BASE,
    reportedEbit: money("1000"),
    leases: {
      totalLiability: money("200"),
      currentLiability: null,
      noncurrentLiability: null,
    },
    researchAndDevelopment: { fiscalYears: [] },
  },
  { baseRevenue: "10000", industryKey: null, preTaxCostOfDebt: "0.05" },
);

const CONTEXT: NormalizationContext = {
  baseRevenue: "10000",
  marginalTaxRate: "0.25",
  capitalization: CAPITALIZATION,
};

function facts(
  mutate: (draft: NormalizationFacts) => void = () => {},
): NormalizationFacts {
  const draft: NormalizationFacts = {
    baseFiscalYearEnd: BASE,
    income: {
      pretaxIncome: fact(
        "900",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      ),
      incomeTax: fact("180", "IncomeTaxExpenseBenefit"),
      shareBasedCompensation: fact("70", "ShareBasedCompensation"),
    },
    balance: {
      equity: fact("3000", "StockholdersEquity"),
      minorityInterest: fact("100", "MinorityInterest"),
      cash: fact("400", "CashAndCashEquivalentsAtCarryingValue"),
      liquidInvestments: fact("100", "MarketableSecuritiesCurrent"),
      marketableSecuritiesNoncurrent: null,
      debt: {
        longTermTotal: fact("1500", "LongTermDebt"),
        longTermNoncurrent: null,
        longTermCurrent: null,
        currentTotal: null,
        shortTermBorrowings: null,
        commercialPaper: fact("100", "CommercialPaper"),
        financeLeases: null,
      },
    },
    chargeHistory: ENDS.map((end, index) => ({
      fiscalYearEnd: end,
      revenue: fact("10000", "Revenues", end),
      restructuring:
        index % 2 === 0 ? fact("20", "RestructuringCharges", end) : null,
      impairment:
        index === 0 ? fact("300", "AssetImpairmentCharges", end) : null,
    })),
  };
  mutate(draft);
  return draft;
}

describe("normalization-1.0.0", () => {
  const normalization = buildNormalization(facts(), CONTEXT);

  it("derives debt, excess cash and the reported and adjusted invested capital", () => {
    expect(normalization.debt).toMatchObject({
      status: "resolved",
      recipe: "long_term_total_plus_short_term",
      total: "1600",
    });
    expect(normalization.excessCash).toMatchObject({
      status: "resolved",
      total: "500",
    });
    // 3.000 + 100 + 1.600 − 500 = 4.200; más 200 de arrendamientos.
    expect(normalization.investedCapital).toStrictEqual({
      version: "invested-capital-1.0.0",
      status: "resolved",
      equity: "3000",
      minorityInterest: "100",
      minorityInterestBasis: "reported",
      debt: "1600",
      cash: "500",
      reported: "4200",
      capitalizationDelta: "200",
      adjusted: "4400",
    });
  });

  it("reverses only the charge that does not come back", () => {
    expect(normalization.charges.impairment).toMatchObject({
      status: "applied",
      ebitAdjustment: "300",
    });
    expect(normalization.charges.restructuring).toMatchObject({
      status: "not_applied",
      reason: "recurring",
      recurringIn: ["2023-12-31", "2021-12-31"],
    });
  });

  it("publishes the adjusted base with the effective tax rate", () => {
    expect(normalization.taxRate).toMatchObject({
      effective: "0.2",
      basis: "effective",
      applied: "0.2",
      marginal: "0.25",
    });
    // EBIT 1.000 + 10 de interés implícito + 300 de deterioro = 1.310.
    expect(normalization.base).toStrictEqual({
      ebitReported: "1000",
      ebitAdjusted: "1310",
      ebitMarginAdjusted: "0.131",
      nopatAdjusted: "1048",
      returnOnCapitalAdjusted: "0.2381818181818181818181818181818182",
      salesToCapitalAdjusted: "2.272727272727272727272727272727273",
    });
  });

  it("declares every adjustment, including the ones it does not make", () => {
    expect(
      normalization.ledger.map(({ id, target, status, reason, amount }) => ({
        id,
        target,
        status,
        reason,
        amount,
      })),
    ).toStrictEqual([
      {
        id: "operating_lease_capitalization",
        target: "ebit",
        status: "applied",
        reason: null,
        amount: "10",
      },
      {
        id: "operating_lease_capitalization",
        target: "invested_capital",
        status: "applied",
        reason: null,
        amount: "200",
      },
      {
        id: "operating_lease_capitalization",
        target: "debt",
        status: "applied",
        reason: null,
        amount: "200",
      },
      {
        id: "rd_capitalization",
        target: "ebit",
        status: "not_applied",
        reason: "not_reported",
        amount: null,
      },
      {
        id: "rd_capitalization",
        target: "invested_capital",
        status: "not_applied",
        reason: "not_reported",
        amount: null,
      },
      {
        id: "restructuring_non_recurring",
        target: "ebit",
        status: "not_applied",
        reason: "recurring",
        amount: null,
      },
      {
        id: "impairment_non_recurring",
        target: "ebit",
        status: "applied",
        reason: null,
        amount: "300",
      },
      // La compensación en acciones es un gasto: se ve, no se revierte.
      {
        id: "share_based_compensation",
        target: "ebit",
        status: "not_applied",
        reason: "expensed",
        amount: "70",
      },
    ]);
    expect(
      normalization.ledger.find(
        (entry) => entry.id === "impairment_non_recurring",
      )?.evidence,
    ).toStrictEqual(["normalization.facts.chargeHistory.0.impairment"]);
  });

  it("does not add minority interest the equity already includes", () => {
    const included = buildNormalization(
      facts((draft) => {
        draft.balance.equity = {
          ...draft.balance.equity!,
          concept: EQUITY_INCLUDING_MINORITY,
        };
      }),
      CONTEXT,
    );

    expect(included.investedCapital).toMatchObject({
      minorityInterest: null,
      minorityInterestBasis: "included_in_equity",
      reported: "4100",
    });
  });

  it("leaves capital and its ratios unresolved without debt, never with zero debt", () => {
    const unresolved = buildNormalization(
      facts((draft) => {
        draft.balance.debt.longTermTotal = null;
        draft.balance.debt.commercialPaper = null;
      }),
      CONTEXT,
    );

    expect(unresolved.debt).toMatchObject({ status: "unresolved" });
    expect(unresolved.investedCapital).toMatchObject({
      status: "unresolved",
      reason: "debt_unresolved",
    });
    expect(unresolved.base).toMatchObject({
      ebitAdjusted: "1310",
      returnOnCapitalAdjusted: null,
      salesToCapitalAdjusted: null,
    });
  });

  it("names why there is no excess cash or equity", () => {
    expect(
      buildNormalization(
        facts((draft) => {
          draft.balance.cash = null;
        }),
        CONTEXT,
      ),
    ).toMatchObject({
      excessCash: { status: "unresolved", reason: "cash_not_reported" },
      investedCapital: { reason: "excess_cash_unresolved" },
    });
    expect(
      buildNormalization(
        facts((draft) => {
          draft.balance.equity = null;
        }),
        CONTEXT,
      ).investedCapital,
    ).toMatchObject({ reason: "equity_not_reported" });
  });

  it("falls back to the marginal rate and names why", () => {
    const cases: [(draft: NormalizationFacts) => void, string][] = [
      [
        (draft) => (draft.income.pretaxIncome = null),
        "pretax_income_not_reported",
      ],
      [(draft) => (draft.income.incomeTax = null), "income_tax_not_reported"],
      [
        (draft) => (draft.income.pretaxIncome!.value = "-50"),
        "non_positive_pretax_income",
      ],
      [
        (draft) => (draft.income.pretaxIncome!.value = "0"),
        "non_positive_pretax_income",
      ],
      [
        (draft) => (draft.income.incomeTax!.value = "-30"),
        "effective_rate_out_of_range",
      ],
    ];

    for (const [mutate, reason] of cases) {
      expect(buildNormalization(facts(mutate), CONTEXT).taxRate).toMatchObject({
        effective: null,
        effectiveUnavailable: reason,
        basis: "marginal",
        applied: "0.25",
      });
    }
  });

  it("publishes no NOPAT when neither rate exists, outside a run", () => {
    const withoutRates = buildNormalization(
      facts((draft) => {
        draft.income.incomeTax = null;
      }),
      { ...CONTEXT, marginalTaxRate: null },
    );

    expect(withoutRates.taxRate).toMatchObject({
      basis: "unavailable",
      applied: null,
      marginal: null,
    });
    expect(withoutRates.base).toMatchObject({
      ebitAdjusted: "1310",
      nopatAdjusted: null,
      returnOnCapitalAdjusted: null,
      salesToCapitalAdjusted: "2.272727272727272727272727272727273",
    });
  });

  it("does not divide by a non-positive invested capital", () => {
    const negative = buildNormalization(
      facts((draft) => {
        draft.balance.equity!.value = "-5000";
      }),
      CONTEXT,
    );

    expect(negative.investedCapital).toMatchObject({ adjusted: "-3600" });
    expect(negative.base).toMatchObject({
      returnOnCapitalAdjusted: null,
      salesToCapitalAdjusted: null,
    });
  });

  it("recomputes itself and names what was edited by hand", () => {
    expect(normalizationMismatches(normalization, CONTEXT)).toStrictEqual([]);

    const edited = structuredClone(normalization);
    edited.ledger[6]!.amount = "3000";
    edited.base.ebitAdjusted = "4010";
    expect(normalizationMismatches(edited, CONTEXT)).toStrictEqual([
      "normalization.ledger",
      "normalization.base",
    ]);

    const stale = structuredClone(normalization);
    stale.facts.balance.cash!.asOf = "2024-12-31";
    expect(normalizationMismatches(stale, CONTEXT)).toContain(
      "normalization.facts.balance.cash",
    );
  });

  it("rejects facts of another base year or an unordered history", () => {
    const otherBase = buildNormalization(
      facts((draft) => {
        draft.baseFiscalYearEnd = "2024-12-31";
      }),
      CONTEXT,
    );
    expect(normalizationMismatches(otherBase, CONTEXT)).toContain(
      "normalization.facts.baseFiscalYearEnd",
    );

    const unordered = structuredClone(normalization);
    [unordered.facts.chargeHistory[1], unordered.facts.chargeHistory[2]] = [
      unordered.facts.chargeHistory[2]!,
      unordered.facts.chargeHistory[1]!,
    ];
    expect(normalizationMismatches(unordered, CONTEXT)).toContain(
      "normalization.facts.chargeHistory.2",
    );
  });
});

describe("normalization with zero-debt evidence", () => {
  const noDebt = (draft: NormalizationFacts) => {
    draft.balance.debt.longTermTotal = null;
    draft.balance.debt.commercialPaper = null;
    draft.zeroDebtEvidence = zeroDebtEvidenceFixture(BASE);
  };

  it("resolves invested capital with zero debt and freezes the evidence", () => {
    const normalization = buildNormalization(facts(noDebt), CONTEXT);

    expect(normalization.debt).toMatchObject({
      version: "reported-debt-1.1.0",
      status: "zero_with_evidence",
      total: "0",
    });
    // 3.000 + 100 + 0 − 500 = 2.600; más 200 de arrendamientos.
    expect(normalization.investedCapital).toMatchObject({
      status: "resolved",
      debt: "0",
      reported: "2600",
      adjusted: "2800",
    });
    expect(normalizationMismatches(normalization, CONTEXT)).toEqual([]);
  });

  it("lists the evidence among the facts the checks date", () => {
    const paths = listNormalizationFacts(
      buildNormalization(facts(noDebt), CONTEXT),
    ).map((entry) => entry.path);

    expect(paths).toContain(
      "normalization.facts.zeroDebtEvidence.fiscalYears.4.revenue",
    );
  });

  it("rejects evidence carried next to a recipe that closes", () => {
    const normalization = buildNormalization(
      facts((draft) => {
        draft.zeroDebtEvidence = zeroDebtEvidenceFixture(BASE);
      }),
      CONTEXT,
    );

    expect(normalization.debt.version).toBe("reported-debt-1.0.0");
    expect(normalizationMismatches(normalization, CONTEXT)).toContain(
      "normalization.facts.zeroDebtEvidence",
    );
  });

  it("rejects evidence of another base year or edited to hold", () => {
    const stale = buildNormalization(
      facts((draft) => {
        noDebt(draft);
        draft.zeroDebtEvidence = zeroDebtEvidenceFixture("2024-12-31");
      }),
      CONTEXT,
    );
    const edited = buildNormalization(facts(noDebt), CONTEXT);
    edited.facts.zeroDebtEvidence = zeroDebtEvidenceFixture(BASE, {
      interest: "100",
    });

    expect(normalizationMismatches(stale, CONTEXT)).toContain(
      "normalization.facts.zeroDebtEvidence.fiscalYears.0",
    );
    expect(normalizationMismatches(edited, CONTEXT)).toEqual(
      expect.arrayContaining([
        "normalization.facts.zeroDebtEvidence",
        "normalization.debt",
      ]),
    );
  });

  it("does not carry the evidence when there is none", () => {
    expect("zeroDebtEvidence" in facts()).toBe(false);
  });
});

describe("normalizationFactsFromSeries", () => {
  function item(item: string, concept: string, value: string, asOf: string) {
    return {
      item,
      concept,
      value,
      unit: "USD",
      currency: "USD",
      asOf,
      observationId: "00000000-0000-4000-8000-000000000001",
      availableAt: "2026-02-15T21:00:00.000Z",
      recordedAt: "2026-02-16T00:00:00.000Z",
      sourceDocumentId: "0000000000-26-000001",
    };
  }

  it("keeps the concept the series chose and up to four previous years", () => {
    const series = {
      version: "annual-fundamentals-1.5.0",
      fiscalYears: [...ENDS, "2020-12-31", "2019-12-31"].map((end) => ({
        fiscalYearEnd: end,
        items: {
          revenue: item("revenue", "us-gaap:Revenues", "10", end),
          debt_long_term_noncurrent: item(
            "debt_long_term_noncurrent",
            "us-gaap:LongTermDebtAndCapitalLeaseObligations",
            "5",
            end,
          ),
          impairment_charges: item(
            "impairment_charges",
            "us-gaap:GoodwillImpairmentLoss",
            "1",
            end,
          ),
        },
      })),
    } as unknown as AnnualFundamentals;

    const result = normalizationFactsFromSeries(series, (value) =>
      money(value.value, value.asOf),
    )!;

    expect(result.baseFiscalYearEnd).toBe(BASE);
    expect(result.balance.debt.longTermNoncurrent?.concept).toBe(
      "us-gaap:LongTermDebtAndCapitalLeaseObligations",
    );
    expect(result.balance.cash).toBeNull();
    expect(
      result.chargeHistory.map((year) => year.fiscalYearEnd),
    ).toStrictEqual(ENDS);
    expect(result.chargeHistory[3]?.impairment?.concept).toBe(
      "us-gaap:GoodwillImpairmentLoss",
    );
  });

  it("has nothing to normalize without a fiscal year", () => {
    expect(
      normalizationFactsFromSeries(
        { version: "annual-fundamentals-1.5.0", fiscalYears: [] },
        (value) => money(value.value),
      ),
    ).toBeNull();
  });
});
