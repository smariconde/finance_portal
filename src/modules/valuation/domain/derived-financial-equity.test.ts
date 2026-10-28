import { describe, expect, it } from "vitest";

import type { AnnualFundamentals, LineItemValue } from "./annual-fundamentals";
import { deriveFinancialEquity } from "./derived-financial-equity";
import type { FinancialFilingEvidence } from "./financial-filing-evidence";

const fact = (
  item: "common_equity" | "common_net_income",
  value: string,
  asOf: string,
): LineItemValue => ({
  item,
  concept:
    item === "common_equity"
      ? "us-gaap:CommonStockholdersEquity"
      : "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
  value,
  unit: "USD",
  currency: "USD",
  asOf,
  observationId: "70000000-0000-4000-8000-000000000001",
  availableAt: "2026-02-01T00:00:00.000Z",
  recordedAt: "2026-02-01T00:00:00.000Z",
  sourceDocumentId: "synthetic-10k",
});

const series = (
  current = "120",
  prior = "100",
  income = "11",
): AnnualFundamentals => ({
  version: "annual-fundamentals-1.5.0",
  fiscalYears: [
    {
      fiscalYearEnd: "2025-12-31",
      items: {
        common_equity: fact("common_equity", current, "2025-12-31"),
        common_net_income: fact("common_net_income", income, "2025-12-31"),
      },
    },
    {
      fiscalYearEnd: "2024-12-31",
      items: { common_equity: fact("common_equity", prior, "2024-12-31") },
    },
  ],
});

const toFact = (item: LineItemValue) => ({
  value: item.value,
  currency: item.currency ?? "USD",
  unit: "monetary" as const,
  asOf: item.asOf,
  availableAt: item.availableAt,
  sourceId: "sec-edgar",
  sourceDocumentId: item.sourceDocumentId,
  observationId: item.observationId,
  qualityFlags: [],
});

describe("derived-financial-equity-1.0.0", () => {
  it("derives a common ROE from the two reported common-equity balances", () => {
    const result = deriveFinancialEquity(series(), toFact);
    expect(result).toMatchObject({
      status: "ready",
      roe: "0.1",
      fiscalYearEnd: "2025-12-31",
    });
  });

  it("never substitutes total stockholders equity for common equity", () => {
    const input = series();
    const current = {
      ...input.fiscalYears[0]!,
      items: { equity: fact("common_equity", "120", "2025-12-31") },
    };
    expect(
      deriveFinancialEquity(
        {
          ...input,
          fiscalYears: [current, input.fiscalYears[1]!],
        } as AnnualFundamentals,
        toFact,
      ),
    ).toMatchObject({ status: "unavailable", reason: "common_equity_missing" });
  });

  it("uses reconciled filing tables when companyfacts omits common book", () => {
    const input = series();
    const [current, prior] = input.fiscalYears;
    const missing = {
      ...input,
      fiscalYears: [
        {
          ...current!,
          items: { common_net_income: current!.items.common_net_income },
        },
        { ...prior!, items: {} },
      ],
    } as AnnualFundamentals;
    const filing: FinancialFilingEvidence = {
      version: "financial-filing-evidence-1.1.0",
      fiscalYearEnd: "2025-12-31",
      commonBook: toFact(fact("common_equity", "120", "2025-12-31")),
      priorBook: toFact(fact("common_equity", "100", "2024-12-31")),
      commonIncome: toFact(fact("common_net_income", "11", "2025-12-31")),
      commonDividends: toFact(fact("common_net_income", "5", "2025-12-31")),
      netRepurchases: toFact(fact("common_net_income", "0", "2025-12-31")),
      payout: "0.45454545454545454545",
      regulatoryCapital: "Synthetic capital check.",
      assetQuality: "Synthetic loan quality check.",
      cleanSurplus: "Synthetic equity rollforward check.",
      sourceDocumentId: "synthetic-10k",
      availableAt: "2026-02-01T00:00:00.000Z",
    };
    expect(deriveFinancialEquity(missing, toFact, filing)).toMatchObject({
      status: "ready",
      roe: "0.1",
      commonBookEquity: {
        sourceId: "sec-edgar",
      },
    });
    expect(deriveFinancialEquity(missing, toFact, null)).toMatchObject({
      status: "unavailable",
      reason: "common_equity_missing",
    });
    expect(
      deriveFinancialEquity(missing, toFact, {
        ...filing,
        commonIncome: { ...filing.commonIncome, value: "12" },
      }),
    ).toMatchObject({ status: "unavailable", reason: "common_income_missing" });
  });

  it.each([
    ["0", "100", "11", "non_positive_book"],
    ["120", "0", "11", "non_positive_book"],
    ["120", "100", "-11", "negative_roe"],
  ])("names an invalid financial base", (current, prior, income, reason) => {
    expect(
      deriveFinancialEquity(series(current, prior, income), toFact),
    ).toMatchObject({ status: "unavailable", reason });
  });

  it("names missing common income and currency mismatch", () => {
    const input = series();
    expect(
      deriveFinancialEquity(
        {
          ...input,
          fiscalYears: [
            {
              ...input.fiscalYears[0]!,
              items: {
                common_equity: input.fiscalYears[0]!.items.common_equity,
              },
            },
            input.fiscalYears[1]!,
          ],
        },
        toFact,
      ),
    ).toMatchObject({ status: "unavailable", reason: "common_income_missing" });
    const mismatched = {
      ...input,
      fiscalYears: [
        {
          ...input.fiscalYears[0]!,
          items: {
            ...input.fiscalYears[0]!.items,
            common_net_income: {
              ...input.fiscalYears[0]!.items.common_net_income!,
              currency: "EUR",
            },
          },
        },
        input.fiscalYears[1]!,
      ],
    };
    expect(deriveFinancialEquity(mismatched, toFact)).toMatchObject({
      status: "unavailable",
      reason: "currency_mismatch",
    });
  });

  it("requires the prior balance from the adjacent fiscal year", () => {
    const input = series();
    expect(
      deriveFinancialEquity(
        {
          ...input,
          fiscalYears: [
            input.fiscalYears[0]!,
            { ...input.fiscalYears[1]!, fiscalYearEnd: "2023-12-31" },
          ],
        },
        toFact,
      ),
    ).toMatchObject({ status: "unavailable", reason: "prior_equity_missing" });
  });

  it("rejects non-finite source values before they enter a snapshot", () => {
    expect(() => deriveFinancialEquity(series("Infinity"), toFact)).toThrow();
  });
});
