import type { AnnualFundamentals, LineItemValue } from "./annual-fundamentals";
import { divide, parseDecimal, sum, ZERO } from "./decimal-policy";
import type { MonetaryFact } from "./valuation-facts";
import type { FinancialFilingEvidence } from "./financial-filing-evidence";

/** Financial equity is never inferred from equity that may include preferred stock. */
export const DERIVED_FINANCIAL_EQUITY_VERSION =
  "derived-financial-equity-1.1.0";

export type DerivedFinancialEquity =
  | {
      readonly status: "ready";
      readonly fiscalYearEnd: string;
      readonly commonBookEquity: MonetaryFact;
      readonly currentBook: MonetaryFact;
      readonly priorBook: MonetaryFact;
      readonly commonIncome: MonetaryFact;
      readonly roe: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "common_equity_missing"
        | "common_income_missing"
        | "prior_equity_missing"
        | "currency_mismatch"
        | "non_positive_book"
        | "negative_roe";
    };

export function deriveFinancialEquity(
  series: AnnualFundamentals | null,
  toFact: (item: LineItemValue) => MonetaryFact,
  filing: FinancialFilingEvidence | null = null,
): DerivedFinancialEquity {
  const current = series?.fiscalYears[0];
  const prior = series?.fiscalYears[1];
  const currentItem = current?.items.common_equity;
  const priorItem = prior?.items.common_equity;
  const incomeItem = current?.items.common_net_income;

  const fiscalGapDays =
    current === undefined || prior === undefined
      ? null
      : (Date.parse(`${current.fiscalYearEnd}T00:00:00Z`) -
          Date.parse(`${prior.fiscalYearEnd}T00:00:00Z`)) /
        86_400_000;
  if (fiscalGapDays === null || fiscalGapDays < 330 || fiscalGapDays > 370)
    return { status: "unavailable", reason: "prior_equity_missing" };

  if (currentItem === undefined && filing === null)
    return { status: "unavailable", reason: "common_equity_missing" };
  if (priorItem === undefined && filing === null)
    return { status: "unavailable", reason: "prior_equity_missing" };
  if (incomeItem === undefined && filing === null)
    return { status: "unavailable", reason: "common_income_missing" };
  if (
    filing !== null &&
    (filing.fiscalYearEnd !== current?.fiscalYearEnd ||
      filing.priorBook.asOf !== prior?.fiscalYearEnd)
  )
    return { status: "unavailable", reason: "prior_equity_missing" };
  if (
    (currentItem !== undefined && currentItem.currency === null) ||
    (priorItem !== undefined && priorItem.currency === null) ||
    (incomeItem !== undefined && incomeItem.currency === null) ||
    (currentItem !== undefined &&
      priorItem !== undefined &&
      currentItem.currency !== priorItem.currency) ||
    (currentItem !== undefined &&
      incomeItem !== undefined &&
      currentItem.currency !== incomeItem.currency)
  )
    return { status: "unavailable", reason: "currency_mismatch" };

  const currentBook =
    filing?.commonBook ??
    (currentItem === undefined ? null : toFact(currentItem));
  const priorBook =
    filing?.priorBook ?? (priorItem === undefined ? null : toFact(priorItem));
  const commonIncome =
    filing?.commonIncome ??
    (incomeItem === undefined ? null : toFact(incomeItem));
  if (currentBook === null || priorBook === null || commonIncome === null)
    return { status: "unavailable", reason: "common_equity_missing" };
  if (
    filing !== null &&
    currentItem !== undefined &&
    !parseDecimal(currentItem.value, "reportedCommonBook").eq(
      parseDecimal(filing.commonBook.value, "filingCommonBook"),
    )
  )
    return { status: "unavailable", reason: "common_equity_missing" };
  if (
    filing !== null &&
    priorItem !== undefined &&
    !parseDecimal(priorItem.value, "reportedPriorBook").eq(
      parseDecimal(filing.priorBook.value, "filingPriorBook"),
    )
  )
    return { status: "unavailable", reason: "prior_equity_missing" };
  if (
    filing !== null &&
    incomeItem !== undefined &&
    !parseDecimal(incomeItem.value, "reportedCommonIncome").eq(
      parseDecimal(filing.commonIncome.value, "filingCommonIncome"),
    )
  )
    return { status: "unavailable", reason: "common_income_missing" };
  if (
    currentBook.currency !== priorBook.currency ||
    currentBook.currency !== commonIncome.currency
  )
    return { status: "unavailable", reason: "currency_mismatch" };

  const currentValue = parseDecimal(currentBook.value, "commonBook.current");
  const priorValue = parseDecimal(priorBook.value, "commonBook.prior");
  const income = parseDecimal(commonIncome.value, "commonIncome");
  if (!currentValue.gt(ZERO) || !priorValue.gt(ZERO))
    return { status: "unavailable", reason: "non_positive_book" };
  if (income.lt(ZERO)) return { status: "unavailable", reason: "negative_roe" };

  const averageBook = divide(
    sum([currentValue, priorValue]),
    parseDecimal("2", "averageBook"),
    "averageBook",
  );
  return {
    status: "ready",
    fiscalYearEnd: current!.fiscalYearEnd,
    commonBookEquity: currentBook,
    currentBook,
    priorBook,
    commonIncome,
    roe: divide(income, averageBook, "roe").toString(),
  };
}
