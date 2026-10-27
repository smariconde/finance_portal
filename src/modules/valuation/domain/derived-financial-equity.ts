import type { AnnualFundamentals, LineItemValue } from "./annual-fundamentals";
import { divide, parseDecimal, sum, ZERO } from "./decimal-policy";
import type { MonetaryFact } from "./valuation-facts";
import type { StoredFinancialDeclaration } from "./financial-declaration";

/** Financial equity is never inferred from equity that may include preferred stock. */
export const DERIVED_FINANCIAL_EQUITY_VERSION =
  "derived-financial-equity-1.0.0";

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
  declaration: StoredFinancialDeclaration | null = null,
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

  if (currentItem === undefined && declaration?.commonBook == null)
    return { status: "unavailable", reason: "common_equity_missing" };
  if (priorItem === undefined && declaration?.commonBook == null)
    return { status: "unavailable", reason: "prior_equity_missing" };
  if (incomeItem === undefined)
    return { status: "unavailable", reason: "common_income_missing" };
  if (
    declaration?.commonBook != null &&
    (declaration.fiscalYearEnd !== current?.fiscalYearEnd ||
      declaration.commonBook.priorFiscalYearEnd !== prior?.fiscalYearEnd)
  )
    return { status: "unavailable", reason: "prior_equity_missing" };
  if (
    (currentItem !== undefined && currentItem.currency === null) ||
    (priorItem !== undefined && priorItem.currency === null) ||
    incomeItem.currency === null ||
    (currentItem !== undefined &&
      priorItem !== undefined &&
      currentItem.currency !== priorItem.currency) ||
    (currentItem !== undefined &&
      currentItem.currency !== incomeItem.currency) ||
    (declaration?.commonBook != null &&
      declaration.commonBook.currency !== incomeItem.currency)
  )
    return { status: "unavailable", reason: "currency_mismatch" };

  const declared = declaration?.commonBook ?? null;
  const ownerFact = (value: string, asOf: string): MonetaryFact => ({
    value,
    asOf,
    currency: declared!.currency,
    unit: "monetary",
    availableAt: declaration!.availableAt,
    sourceId: "owner-financial-declaration",
    sourceDocumentId: declaration!.sourceDocumentId,
    observationId: null,
    qualityFlags: ["owner_transcribed"],
  });
  const currentBook =
    currentItem === undefined
      ? ownerFact(declared!.currentValue, current!.fiscalYearEnd)
      : toFact(currentItem);
  const priorBook =
    priorItem === undefined
      ? ownerFact(declared!.priorValue, declared!.priorFiscalYearEnd)
      : toFact(priorItem);
  const commonIncome = toFact(incomeItem);
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
