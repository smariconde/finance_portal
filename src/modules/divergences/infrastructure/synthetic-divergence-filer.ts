import {
  corporateActionSchema,
  type CorporateAction,
} from "@/modules/corporate-actions/domain/reporting-succession";
import type {
  DailyClose,
  PriceEvent,
} from "@/modules/prices/domain/daily-close";
import {
  pointInTimeQuerySchema,
  type PointInTimeQuery,
} from "@/modules/temporal/domain/point-in-time-query";
import {
  ANNUAL_FUNDAMENTALS_VERSION,
  type AnnualFundamentals,
  type FundamentalRow,
  type LineItemValue,
} from "@/modules/valuation/domain/annual-fundamentals";

import { computeDilutionBridge } from "../domain/dilution-bridge";
import { computeDivergenceViews } from "../domain/divergence-views";
import { selectFiscalEndpoints } from "../domain/fiscal-endpoints";

/**
 * A synthetic filer for the divergence golden and property tests (`F8-04`).
 * It runs the whole domain chain —fiscal closes, split basis, views, bridge—
 * the way the sector reading does, from inputs a reviewer can read. Prices
 * are synthetic: Yahoo's rights forbid freezing real ones (ADR 0026).
 */

export const SYNTHETIC_SECURITY_ID = "11111111-1111-4111-8111-111111111111";

export type SyntheticYear = {
  readonly fiscalYearEnd: string;
  /** Raw close and its market date; `null` leaves the year without a price. */
  readonly close: {
    readonly marketDate: string;
    readonly value: string;
  } | null;
  /** Instant shares at the fiscal close; `null` when not reported. */
  readonly shares: string | null;
  readonly diluted: string;
  readonly netIncome: string;
  readonly eps: string;
  /** When the 10-K was accepted; defaults to February 1 of the next year. */
  readonly publishedAt?: string;
  /** Later EPS figures for the same year, each with its acceptance. */
  readonly epsRevisions?: readonly {
    readonly value: string;
    readonly availableAt: string;
  }[];
};

export type SyntheticSplit = {
  readonly ratio: string;
  /** The market's ex-date, in the price events. */
  readonly marketDate: string;
  /** The SEC's first fiscal period end on the new basis and its acceptance. */
  readonly secEffectiveOn: string;
  readonly secAvailableAt: string;
};

export const SYNTHETIC_QUERY: PointInTimeQuery = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-03-01T00:00:00.000Z",
  revisionPolicy: "as_known",
  knownAt: "2026-03-01T00:00:00.000Z",
  sourcePolicyVersion: "source-policy-1.0.0",
});

function publishedAt(year: SyntheticYear): string {
  return (
    year.publishedAt ??
    `${Number(year.fiscalYearEnd.slice(0, 4)) + 1}-02-01T10:00:00.000Z`
  );
}

function item(
  id: LineItemValue["item"],
  year: SyntheticYear,
  value: string,
  unit: string,
): LineItemValue {
  return {
    item: id,
    concept: `us-gaap:${id}`,
    value,
    unit,
    currency: unit === "USD" ? "USD" : null,
    asOf: year.fiscalYearEnd,
    observationId: `${id}-${year.fiscalYearEnd}`,
    availableAt: publishedAt(year),
    recordedAt: publishedAt(year),
    sourceDocumentId: `10-K-${year.fiscalYearEnd}`,
  };
}

function epsRow(
  year: SyntheticYear,
  value: string,
  availableAt: string,
): FundamentalRow {
  return {
    observationId: `eps-${year.fiscalYearEnd}-${availableAt}`,
    subjectId: SYNTHETIC_SECURITY_ID,
    concept: "us-gaap:EarningsPerShareDiluted",
    periodType: "annual",
    periodStart: `${year.fiscalYearEnd.slice(0, 4)}-01-01`,
    asOf: year.fiscalYearEnd,
    unit: "monetary_per_share",
    currency: "USD",
    value,
    availableAt,
    recordedAt: availableAt,
    sourceDocumentId: `10-K-${year.fiscalYearEnd}`,
  };
}

/** Rows the reader would hand the selection for share counts too. */
function shareRows(year: SyntheticYear): FundamentalRow[] {
  const rows: FundamentalRow[] = [
    {
      ...epsRow(year, year.diluted, publishedAt(year)),
      observationId: `diluted_shares-${year.fiscalYearEnd}`,
      concept: "us-gaap:diluted_shares",
      unit: "shares",
      currency: null,
    },
  ];
  if (year.shares !== null) {
    rows.push({
      ...epsRow(year, year.shares, publishedAt(year)),
      observationId: `shares_outstanding-${year.fiscalYearEnd}`,
      concept: "us-gaap:shares_outstanding",
      periodType: "instant",
      periodStart: null,
      unit: "shares",
      currency: null,
    });
  }
  return rows;
}

export function syntheticFiler(input: {
  readonly years: readonly SyntheticYear[];
  readonly splits?: readonly SyntheticSplit[];
  readonly query?: PointInTimeQuery;
}) {
  const years = [...input.years].sort((a, b) =>
    b.fiscalYearEnd.localeCompare(a.fiscalYearEnd),
  );
  const series: AnnualFundamentals = {
    version: ANNUAL_FUNDAMENTALS_VERSION,
    fiscalYears: years.map((year) => ({
      fiscalYearEnd: year.fiscalYearEnd,
      items: {
        net_income: item("net_income", year, year.netIncome, "USD"),
        diluted_shares: item("diluted_shares", year, year.diluted, "shares"),
        ...(year.shares === null
          ? {}
          : {
              shares_outstanding: item(
                "shares_outstanding",
                year,
                year.shares,
                "shares",
              ),
            }),
      },
    })),
  };
  const epsRows = years.flatMap((year) => [
    epsRow(year, year.eps, publishedAt(year)),
    ...(year.epsRevisions ?? []).map((revision) =>
      epsRow(year, revision.value, revision.availableAt),
    ),
    ...shareRows(year),
  ]);
  const closes: DailyClose[] = years
    .filter((year) => year.close !== null)
    .map((year) => ({
      securityId: SYNTHETIC_SECURITY_ID,
      marketDate: year.close!.marketDate,
      close: year.close!.value,
      currency: "USD",
    }));
  const splits = input.splits ?? [];
  const events: PriceEvent[] = splits.map((split) => ({
    securityId: SYNTHETIC_SECURITY_ID,
    eventType: "split",
    effectiveOn: split.marketDate,
    value: split.ratio,
    currency: null,
  }));
  const actions: CorporateAction[] = splits.map((split, index) =>
    corporateActionSchema.parse({
      corporateActionId: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      actionType: "split",
      subjectType: "legal_entity",
      subjectId: SYNTHETIC_SECURITY_ID,
      announcedAt: null,
      effectiveOn: split.secEffectiveOn,
      availableAt: split.secAvailableAt,
      sourceId: "sec-edgar",
      sourceDocumentId: `split-${index}`,
      terms: { ratio: split.ratio },
      contentHash: "a".repeat(64),
      recordedAt: split.secAvailableAt,
    }),
  );
  const query = input.query ?? SYNTHETIC_QUERY;

  return (horizonYears: 2 | 5) => {
    const pair = selectFiscalEndpoints({
      series,
      epsRows,
      closes,
      events,
      actions,
      query,
      horizonYears,
    });
    const views = computeDivergenceViews(pair);
    return { pair, views, bridge: computeDilutionBridge(pair, views) };
  };
}
