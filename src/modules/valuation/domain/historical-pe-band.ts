import type {
  DailyClose,
  PriceEvent,
} from "@/modules/prices/domain/daily-close";
import type { AnnualFundamentals } from "./annual-fundamentals";
import {
  divide,
  formatDecimal,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";

export const HISTORICAL_PE_BAND_VERSION = "historical-pe-band-1.0.0";
export const HISTORICAL_PE_YEARS = 5;
export const FISCAL_CLOSE_LAG_DAYS = 7;

export type HistoricalPePoint = {
  readonly fiscalYearEnd: string;
  readonly priceDate: string | null;
  readonly value: string | null;
  readonly reason:
    | "no_close"
    | "split_basis_unreconciled"
    | "missing_income_or_shares"
    | "non_positive_input"
    | "currency_mismatch"
    | null;
};

export type HistoricalPeBand = {
  readonly version: typeof HISTORICAL_PE_BAND_VERSION;
  readonly unavailableReason: "multiple_share_classes" | null;
  readonly points: readonly HistoricalPePoint[];
  readonly minimum: string | null;
  readonly median: string | null;
  readonly maximum: string | null;
  readonly n: number;
};

function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

/** Fiscal aligned market cap / annual reported net income, from stored data. */
export function historicalPeBand(input: {
  readonly series: AnnualFundamentals;
  readonly closes: readonly DailyClose[];
  readonly events: readonly PriceEvent[];
  readonly asOf: string;
  readonly knownAt: string;
  readonly currency: string;
  readonly commonShareClasses: number;
}): HistoricalPeBand {
  if (input.commonShareClasses !== 1) {
    return {
      version: HISTORICAL_PE_BAND_VERSION,
      unavailableReason: "multiple_share_classes",
      points: [],
      minimum: null,
      median: null,
      maximum: null,
      n: 0,
    };
  }
  const years = input.series.fiscalYears
    .filter((year) => year.fiscalYearEnd <= input.asOf)
    .slice(0, HISTORICAL_PE_YEARS);
  const points = years.map((year): HistoricalPePoint => {
    const close = input.closes
      .filter(
        (candidate) =>
          candidate.marketDate <= year.fiscalYearEnd &&
          candidate.marketDate < input.knownAt.slice(0, 10) &&
          daysBetween(candidate.marketDate, year.fiscalYearEnd) <=
            FISCAL_CLOSE_LAG_DAYS,
      )
      .sort((left, right) =>
        right.marketDate.localeCompare(left.marketDate),
      )[0];
    if (close === undefined)
      return {
        fiscalYearEnd: year.fiscalYearEnd,
        priceDate: null,
        value: null,
        reason: "no_close",
      };
    const priceDate = close.marketDate;
    const missing = (reason: Exclude<HistoricalPePoint["reason"], null>) => ({
      fiscalYearEnd: year.fiscalYearEnd,
      priceDate,
      value: null,
      reason,
    });
    // Raw market closes are not restated. Without SEC/market reconciliation,
    // a subsequent split makes the historical ratio unprovable.
    if (
      input.events.some(
        (event) =>
          event.eventType === "split" &&
          event.effectiveOn > priceDate &&
          event.effectiveOn <= input.asOf,
      )
    )
      return missing("split_basis_unreconciled");
    const income = year.items.net_income;
    const shares = year.items.shares_outstanding;
    if (income === undefined || shares === undefined)
      return missing("missing_income_or_shares");
    if (close.currency !== input.currency || income.currency !== input.currency)
      return missing("currency_mismatch");
    const price = parseDecimal(close.close, "historicalPe.price");
    const count = parseDecimal(shares.value, "historicalPe.shares");
    const earnings = parseDecimal(income.value, "historicalPe.income");
    if (!price.gt(ZERO) || !count.gt(ZERO) || !earnings.gt(ZERO))
      return missing("non_positive_input");
    return {
      fiscalYearEnd: year.fiscalYearEnd,
      priceDate,
      value: formatDecimal(
        divide(price.times(count), earnings, "historicalPe.income"),
        "historicalPe.value",
      ),
      reason: null,
    };
  });
  const values = points
    .flatMap((point) =>
      point.value === null
        ? []
        : [parseDecimal(point.value, "historicalPe.value")],
    )
    .sort((left, right) => left.comparedTo(right));
  const n = values.length;
  const median: Dec | null =
    n === 0
      ? null
      : n % 2 === 1
        ? values[Math.floor(n / 2)]!
        : values[n / 2 - 1]!.plus(values[n / 2]!).dividedBy(2);
  return {
    version: HISTORICAL_PE_BAND_VERSION,
    unavailableReason: null,
    points,
    minimum: n === 0 ? null : formatDecimal(values[0]!, "historicalPe.min"),
    median:
      median === null ? null : formatDecimal(median, "historicalPe.median"),
    maximum: n === 0 ? null : formatDecimal(values[n - 1]!, "historicalPe.max"),
    n,
  };
}
