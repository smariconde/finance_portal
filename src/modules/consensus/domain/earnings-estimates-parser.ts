import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * Reader of Alpha Vantage's `EARNINGS_ESTIMATES` (ADR 0083).
 *
 * Measured on 2026-11-18 (AAPL, MSFT, AMZN, JNJ, CAT and IBM): an object
 * `{symbol, estimates[]}` with two `"fiscal year"` rows —the current fiscal
 * year and the next— and forty `"fiscal quarter"` rows back to 2017. Every
 * number is text with four (EPS, counts) or two (revenue) decimals; the
 * downward revisions came `null` everywhere. `date` is the calendar month end
 * of the period, never a publication date. The API answers its errors with a
 * 200 and a single `Note`, `Information` or `Error Message` key.
 *
 * Only fiscal years are returned: future quarters do not add up to twelve
 * months and past ones carry no date, so they are counted and dropped.
 */
export const EARNINGS_ESTIMATES_PARSER_VERSION = "av-earnings-estimates-1.0.0";

const ROW_KEYS = [
  "date",
  "horizon",
  "eps_estimate_average",
  "eps_estimate_high",
  "eps_estimate_low",
  "eps_estimate_analyst_count",
  "eps_estimate_average_7_days_ago",
  "eps_estimate_average_30_days_ago",
  "eps_estimate_average_60_days_ago",
  "eps_estimate_average_90_days_ago",
  "eps_estimate_revision_up_trailing_7_days",
  "eps_estimate_revision_down_trailing_7_days",
  "eps_estimate_revision_up_trailing_30_days",
  "eps_estimate_revision_down_trailing_30_days",
  "revenue_estimate_average",
  "revenue_estimate_high",
  "revenue_estimate_low",
  "revenue_estimate_analyst_count",
] as const;

const HORIZONS = ["fiscal year", "fiscal quarter"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,15}$/u;

/** One fiscal year's consensus, every amount as canonical decimal text. */
export type FiscalYearEstimate = {
  /** Calendar month end of the fiscal year, as the source labels it. */
  readonly periodEnd: string;
  readonly epsAverage: string;
  readonly epsHigh: string | null;
  readonly epsLow: string | null;
  readonly epsAnalystCount: number | null;
  readonly epsAverage7DaysAgo: string | null;
  readonly epsAverage30DaysAgo: string | null;
  readonly epsAverage60DaysAgo: string | null;
  readonly epsAverage90DaysAgo: string | null;
  readonly epsRevisionsUp7Days: number | null;
  readonly epsRevisionsDown7Days: number | null;
  readonly epsRevisionsUp30Days: number | null;
  readonly epsRevisionsDown30Days: number | null;
  readonly revenueAverage: string | null;
  readonly revenueHigh: string | null;
  readonly revenueLow: string | null;
  readonly revenueAnalystCount: number | null;
};

export type EarningsEstimatesRejection =
  | "invalid_json"
  | "api_rate_limited"
  | "api_error"
  | "layout_changed"
  | "symbol_mismatch"
  | "invalid_date"
  | "invalid_value"
  | "range_inverted"
  | "duplicate_period"
  | "no_fiscal_years";

export type EarningsEstimatesParseResult =
  | {
      readonly ok: true;
      readonly symbol: string;
      /** Ordered by period end. */
      readonly fiscalYears: readonly FiscalYearEstimate[];
      /** Quarter rows the response carried and the reader dropped. */
      readonly quartersDropped: number;
    }
  | { readonly ok: false; readonly reason: EarningsEstimatesRejection };

const decimal = createDecimalOperations((code) => new Error(code));

class RowRejected extends Error {
  constructor(readonly reason: EarningsEstimatesRejection) {
    super(reason);
  }
}

function amountOf(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !NUMBER_PATTERN.test(value)) {
    throw new RowRejected("invalid_value");
  }
  return decimal.formatDecimal(decimal.parseDecimal(value, path), path);
}

function countOf(value: unknown, path: string): number | null {
  const amount = amountOf(value, path);
  if (amount === null) return null;
  if (!/^\d+$/u.test(amount)) throw new RowRejected("invalid_value");
  const count = Number(amount);
  if (!Number.isSafeInteger(count)) throw new RowRejected("invalid_value");
  return count;
}

function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === text
  );
}

/** `low <= average <= high` whenever the bound is published. */
function assertRange(
  low: string | null,
  average: string | null,
  high: string | null,
  path: string,
): void {
  if (average === null) return;
  const mid = decimal.parseDecimal(average, path);
  if (low !== null && decimal.parseDecimal(low, path).greaterThan(mid)) {
    throw new RowRejected("range_inverted");
  }
  if (high !== null && decimal.parseDecimal(high, path).lessThan(mid)) {
    throw new RowRejected("range_inverted");
  }
}

function fiscalYearOf(row: Record<string, unknown>): FiscalYearEstimate {
  const epsAverage = amountOf(row.eps_estimate_average, "eps_average");
  if (epsAverage === null) throw new RowRejected("invalid_value");
  const estimate: FiscalYearEstimate = {
    periodEnd: row.date as string,
    epsAverage,
    epsHigh: amountOf(row.eps_estimate_high, "eps_high"),
    epsLow: amountOf(row.eps_estimate_low, "eps_low"),
    epsAnalystCount: countOf(row.eps_estimate_analyst_count, "eps_count"),
    epsAverage7DaysAgo: amountOf(row.eps_estimate_average_7_days_ago, "eps_7d"),
    epsAverage30DaysAgo: amountOf(
      row.eps_estimate_average_30_days_ago,
      "eps_30d",
    ),
    epsAverage60DaysAgo: amountOf(
      row.eps_estimate_average_60_days_ago,
      "eps_60d",
    ),
    epsAverage90DaysAgo: amountOf(
      row.eps_estimate_average_90_days_ago,
      "eps_90d",
    ),
    epsRevisionsUp7Days: countOf(
      row.eps_estimate_revision_up_trailing_7_days,
      "up_7d",
    ),
    epsRevisionsDown7Days: countOf(
      row.eps_estimate_revision_down_trailing_7_days,
      "down_7d",
    ),
    epsRevisionsUp30Days: countOf(
      row.eps_estimate_revision_up_trailing_30_days,
      "up_30d",
    ),
    epsRevisionsDown30Days: countOf(
      row.eps_estimate_revision_down_trailing_30_days,
      "down_30d",
    ),
    revenueAverage: amountOf(row.revenue_estimate_average, "revenue_average"),
    revenueHigh: amountOf(row.revenue_estimate_high, "revenue_high"),
    revenueLow: amountOf(row.revenue_estimate_low, "revenue_low"),
    revenueAnalystCount: countOf(
      row.revenue_estimate_analyst_count,
      "revenue_count",
    ),
  };
  assertRange(estimate.epsLow, estimate.epsAverage, estimate.epsHigh, "eps");
  assertRange(
    estimate.revenueLow,
    estimate.revenueAverage,
    estimate.revenueHigh,
    "revenue",
  );
  return estimate;
}

export function parseEarningsEstimates(
  body: string,
  requestedSymbol: string,
): EarningsEstimatesParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return { ok: false, reason: "layout_changed" };
  }
  const envelope = payload as Record<string, unknown>;
  const keys = Object.keys(envelope);
  // Errors come with a 200: the plan's limit as `Note` or `Information`, a bad
  // call as `Error Message`.
  if (keys.length === 1 && (keys[0] === "Note" || keys[0] === "Information")) {
    return { ok: false, reason: "api_rate_limited" };
  }
  if (keys.length === 1 && keys[0] === "Error Message") {
    return { ok: false, reason: "api_error" };
  }
  if (
    keys.length !== 2 ||
    typeof envelope.symbol !== "string" ||
    !Array.isArray(envelope.estimates)
  ) {
    return { ok: false, reason: "layout_changed" };
  }
  if (envelope.symbol !== requestedSymbol) {
    return { ok: false, reason: "symbol_mismatch" };
  }

  const fiscalYears: FiscalYearEstimate[] = [];
  let quartersDropped = 0;
  try {
    for (const candidate of envelope.estimates as unknown[]) {
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        throw new RowRejected("layout_changed");
      }
      const row = candidate as Record<string, unknown>;
      const rowKeys = Object.keys(row);
      if (
        rowKeys.length !== ROW_KEYS.length ||
        ROW_KEYS.some((key) => !(key in row))
      ) {
        throw new RowRejected("layout_changed");
      }
      if (
        typeof row.horizon !== "string" ||
        !(HORIZONS as readonly string[]).includes(row.horizon)
      ) {
        throw new RowRejected("layout_changed");
      }
      if (typeof row.date !== "string" || !isCalendarDate(row.date)) {
        throw new RowRejected("invalid_date");
      }
      if (row.horizon === "fiscal quarter") {
        quartersDropped += 1;
        continue;
      }
      fiscalYears.push(fiscalYearOf(row));
    }
  } catch (error) {
    if (error instanceof RowRejected)
      return { ok: false, reason: error.reason };
    return { ok: false, reason: "invalid_value" };
  }

  fiscalYears.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  for (let index = 1; index < fiscalYears.length; index += 1) {
    if (fiscalYears[index]!.periodEnd === fiscalYears[index - 1]!.periodEnd) {
      return { ok: false, reason: "duplicate_period" };
    }
  }
  if (fiscalYears.length === 0) return { ok: false, reason: "no_fiscal_years" };

  return {
    ok: true,
    symbol: envelope.symbol,
    fiscalYears,
    quartersDropped,
  };
}

/**
 * The one resource the adapter asks for. The key is not here: the egress door
 * appends it (ADR 0083).
 */
export function earningsEstimatesUrl(symbol: string): string {
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error("invalid_estimates_symbol");
  }
  const query = new URLSearchParams({
    function: "EARNINGS_ESTIMATES",
    symbol,
  });
  return `https://www.alphavantage.co/query?${query.toString()}`;
}
