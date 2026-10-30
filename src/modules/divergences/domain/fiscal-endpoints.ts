import type {
  DailyClose,
  PriceEvent,
} from "@/modules/prices/domain/daily-close";
import type { CorporateAction } from "@/modules/corporate-actions/domain/reporting-succession";
import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type {
  AnnualFundamentals,
  FundamentalRow,
  LineItemValue,
} from "@/modules/valuation/domain/annual-fundamentals";

import {
  reconcileFiscalSplitBasis,
  type FiscalSplitBasis,
} from "./fiscal-split-basis";

/** A price must be the fiscal close or one of the preceding seven calendar days. */
export const FISCAL_PRICE_MAX_LAG_DAYS = 7;
/** A 52/53-week fiscal year can move; reject a mismatched comparison year. */
export const FISCAL_HORIZON_TOLERANCE_DAYS = 45;
export const FISCAL_ENDPOINTS_VERSION = "fiscal-endpoints-1.4.0";

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365.2425;
const EPS_CONCEPTS = [
  "us-gaap:IncomeLossFromContinuingOperationsPerDilutedShare",
  "us-gaap:EarningsPerShareDiluted",
] as const;
const BASIC_SHARES_CONCEPTS = [
  "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
] as const;
const DILUTED_NUMERATOR_CONCEPTS = [
  "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted",
] as const;

export type FiscalEndpoint = {
  readonly fiscalYearEnd: string;
  readonly price: DailyClose | null;
  readonly priceLagDays: number | null;
  readonly netIncome: LineItemValue | null;
  readonly dilutedEps: FundamentalRow | null;
  readonly dilutedShares: LineItemValue | null;
  /** Instant shares at fiscal close, never weighted-average diluted shares. */
  readonly sharesOutstanding: LineItemValue | null;
  /** Weighted basic shares of the same fiscal year, for the dilution bridge. */
  readonly basicShares: FundamentalRow | null;
  /** Net income available to common, diluted: EPS's own numerator when tagged. */
  readonly dilutedNumerator: FundamentalRow | null;
  /** Comparable values on the last verified split basis at the query cutoff. */
  readonly splitBasis: FiscalSplitBasis;
  readonly marketCap: string | null;
  readonly missing: readonly string[];
};

export type FiscalEndpointPair = {
  readonly version: typeof FISCAL_ENDPOINTS_VERSION;
  readonly horizonYears: 2 | 5;
  readonly actualYears: number | null;
  readonly latest: FiscalEndpoint | null;
  readonly earlier: FiscalEndpoint | null;
  readonly reason: "no_fiscal_year" | "no_comparable_year" | null;
};

const decimal = createDecimalOperations((code, message) => {
  const error = new Error(message);
  error.name = code;
  return error;
});

function daysBetween(earlier: string, later: string): number {
  return (
    (Date.parse(`${later}T00:00:00.000Z`) -
      Date.parse(`${earlier}T00:00:00.000Z`)) /
    DAY_MS
  );
}

function known(
  availableAt: string,
  recordedAt: string,
  query: PointInTimeQuery,
): boolean {
  if (query.revisionPolicy === "latest_restated") return true;
  return (
    (query.knowledgeBasis === "system_recorded" ? recordedAt : availableAt) <=
    query.knownAt
  );
}

function annualRow(
  rows: readonly FundamentalRow[],
  concepts: readonly string[],
  unit: "monetary_per_share" | "shares" | "monetary",
  end: string,
  query: PointInTimeQuery,
): FundamentalRow | null {
  for (const concept of concepts) {
    const candidates = rows
      .filter((row) => {
        if (
          row.concept !== concept ||
          row.periodType !== "annual" ||
          row.asOf !== end ||
          row.periodStart === null ||
          row.value === null ||
          row.unit !== unit ||
          (unit === "shares"
            ? row.currency !== null
            : row.currency !== "USD") ||
          !known(row.availableAt, row.recordedAt, query)
        )
          return false;
        const length = daysBetween(row.periodStart, end) + 1;
        return length >= 357 && length <= 373;
      })
      .sort(
        (a, b) =>
          b.availableAt.localeCompare(a.availableAt) ||
          a.observationId.localeCompare(b.observationId),
      );
    if (candidates[0] !== undefined) return candidates[0];
  }
  return null;
}

function endpoint(
  year: AnnualFundamentals["fiscalYears"][number],
  epsRows: readonly FundamentalRow[],
  closes: readonly DailyClose[],
  events: readonly PriceEvent[],
  actions: readonly CorporateAction[],
  query: PointInTimeQuery,
): FiscalEndpoint {
  const end = year.fiscalYearEnd;
  const eligible = closes
    .filter(
      (close) =>
        close.marketDate <= end &&
        // DailyClose has no publication instant. A same-day as_known read cannot
        // prove the closing auction had happened, so require a later UTC date.
        (query.revisionPolicy !== "as_known" ||
          close.marketDate < query.knownAt.slice(0, 10)) &&
        daysBetween(close.marketDate, end) <= FISCAL_PRICE_MAX_LAG_DAYS,
    )
    .sort((a, b) => b.marketDate.localeCompare(a.marketDate));
  const price = eligible[0] ?? null;
  const netIncome = year.items.net_income ?? null;
  const dilutedShares = year.items.diluted_shares ?? null;
  const sharesOutstanding = year.items.shares_outstanding ?? null;
  const dilutedEps = annualRow(
    epsRows,
    EPS_CONCEPTS,
    "monetary_per_share",
    end,
    query,
  );
  const basicShares = annualRow(
    epsRows,
    BASIC_SHARES_CONCEPTS,
    "shares",
    end,
    query,
  );
  const dilutedNumerator = annualRow(
    epsRows,
    DILUTED_NUMERATOR_CONCEPTS,
    "monetary",
    end,
    query,
  );
  const selectedRow = (item: LineItemValue | null) =>
    item === null
      ? null
      : (epsRows.find((row) => row.observationId === item.observationId) ??
        null);
  const dilutedSharesRow = selectedRow(dilutedShares);
  const sharesOutstandingRow = selectedRow(sharesOutstanding);
  let splitBasis = reconcileFiscalSplitBasis({
    fiscalYearEnd: end,
    price,
    events,
    actions,
    query,
    eps: dilutedEps,
    dilutedShares: dilutedSharesRow,
    sharesOutstanding: sharesOutstandingRow,
    basicShares,
  });
  if (
    splitBasis.actionIds.length > 0 &&
    ((dilutedShares !== null && dilutedSharesRow === null) ||
      (sharesOutstanding !== null && sharesOutstandingRow === null))
  ) {
    splitBasis = { ...splitBasis, reason: "split_subject_unreconciled" };
  }
  const missing: string[] = [];

  if (price === null) missing.push("price_near_fiscal_close");
  if (netIncome === null) missing.push("net_income");
  if (dilutedEps === null) missing.push("diluted_eps");
  if (dilutedShares === null) missing.push("diluted_shares");
  if (sharesOutstanding === null) missing.push("shares_outstanding_at_close");
  if (splitBasis.reason !== null) missing.push(splitBasis.reason);

  let marketCap: string | null = null;
  if (price !== null && sharesOutstanding !== null) {
    if (splitBasis.reason !== null) {
      missing.push("market_cap_split_basis_unreconciled");
    } else if (
      price.currency !== "USD" ||
      sharesOutstanding.unit !== "shares" ||
      sharesOutstanding.currency !== null
    ) {
      missing.push("market_cap_unit_or_currency_mismatch");
    } else {
      const close = decimal.parseDecimal(
        splitBasis.adjustedPrice!,
        "splitBasis.adjustedPrice",
      );
      const shares = decimal.parseDecimal(
        splitBasis.adjustedSharesOutstanding ?? sharesOutstanding.value,
        "splitBasis.adjustedSharesOutstanding",
      );
      if (close.lte(0) || shares.lte(0)) {
        missing.push("market_cap_non_positive_input");
      } else {
        marketCap = decimal.formatDecimal(close.mul(shares), "marketCap");
      }
    }
  }

  return {
    fiscalYearEnd: end,
    price,
    priceLagDays: price === null ? null : daysBetween(price.marketDate, end),
    netIncome,
    dilutedEps,
    dilutedShares,
    sharesOutstanding,
    basicShares,
    dilutedNumerator,
    splitBasis,
    marketCap,
    missing,
  };
}

/**
 * Align two fiscal closes before calculating any divergence. The caller supplies
 * the point-in-time selected annual series and SEC rows, plus raw close prices
 * and split events for the same security. A missing input remains named rather
 * than becoming zero.
 */
export function selectFiscalEndpoints(input: {
  readonly series: AnnualFundamentals | null;
  readonly epsRows: readonly FundamentalRow[];
  readonly closes: readonly DailyClose[];
  readonly events: readonly PriceEvent[];
  readonly actions: readonly CorporateAction[];
  readonly query: PointInTimeQuery;
  readonly horizonYears: 2 | 5;
}): FiscalEndpointPair {
  const { series, epsRows, closes, query, horizonYears } = input;
  const { events, actions } = input;
  const cutoff =
    query.revisionPolicy === "as_known"
      ? [query.effectiveAt.slice(0, 10), query.knownAt.slice(0, 10)].sort()[0]!
      : query.effectiveAt.slice(0, 10);
  const years = (series?.fiscalYears ?? []).filter(
    (year) => year.fiscalYearEnd <= cutoff,
  );
  const latestYear = years[0];
  if (latestYear === undefined) {
    return {
      version: FISCAL_ENDPOINTS_VERSION,
      horizonYears,
      actualYears: null,
      latest: null,
      earlier: null,
      reason: "no_fiscal_year",
    };
  }

  const expectedDays = horizonYears * DAYS_PER_YEAR;
  const earlierYear = years
    .slice(1)
    .map((year) => ({
      year,
      distance: daysBetween(year.fiscalYearEnd, latestYear.fiscalYearEnd),
    }))
    .filter(
      ({ distance }) =>
        Math.abs(distance - expectedDays) <= FISCAL_HORIZON_TOLERANCE_DAYS,
    )
    .sort(
      (a, b) =>
        Math.abs(a.distance - expectedDays) -
          Math.abs(b.distance - expectedDays) ||
        b.year.fiscalYearEnd.localeCompare(a.year.fiscalYearEnd),
    )[0];

  return {
    version: FISCAL_ENDPOINTS_VERSION,
    horizonYears,
    actualYears:
      earlierYear === undefined ? null : earlierYear.distance / DAYS_PER_YEAR,
    latest: endpoint(latestYear, epsRows, closes, events, actions, query),
    earlier:
      earlierYear === undefined
        ? null
        : endpoint(earlierYear.year, epsRows, closes, events, actions, query),
    reason: earlierYear === undefined ? "no_comparable_year" : null,
  };
}
