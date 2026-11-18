import {
  createDecimalOperations,
  ONE,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import { sessionSettledAt } from "@/modules/prices/domain/price-freshness";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import {
  consensusAt,
  type ConsensusRevision,
  type ConsensusValues,
} from "../domain/consensus-revisions";
import {
  CONSENSUS_STALE_AFTER_DAYS,
  fiscalYearsAhead,
  forwardPe,
  type ForwardPeReading,
  type ForwardPeReason,
} from "../domain/forward-pe";
import type {
  ConsensusRepository,
  OwnerThreshold,
} from "./consensus-repository";

/** The consensus is in the listing's currency; the index lists in dollars. */
const CONSENSUS_CURRENCY = "USD";

/** How far back today's reading looks for the last stored close. */
const LAST_CLOSE_LOOKBACK_DAYS = 120;

/** Five years of sessions at most; the history starts at the first capture. */
const HISTORY_CLOSES_LIMIT = 1_300;

export type ConsensusYearDetail = {
  readonly periodEnd: string;
  readonly values: ConsensusValues;
  /** Average now over the average 90 days ago, minus one; `null` without a positive base. */
  readonly change90Days: string | null;
};

export type ForwardPePoint = {
  readonly marketDate: string;
  readonly forwardPe: string | null;
  readonly reason: ForwardPeReason | null;
};

export type ForwardMultiplesView = {
  /** Today's reading: the last stored close against today's consensus. */
  readonly current: ForwardPeReading;
  /** FY1 and FY2 as the source published them, with their spread. */
  readonly years: readonly ConsensusYearDetail[];
  readonly lastCaptureAt: string | null;
  readonly firstCaptureAt: string | null;
  /** One point per stored close since the first capture. */
  readonly history: readonly ForwardPePoint[];
  /** The owner's threshold in force, or `null`. */
  readonly threshold: OwnerThreshold | null;
};

function lastAtOrBefore(
  instants: readonly string[],
  knownAt: string,
): string | null {
  const limit = Date.parse(knownAt);
  let found: string | null = null;
  for (const instant of instants) {
    if (Date.parse(instant) <= limit) found = instant;
  }
  return found;
}

const decimal = createDecimalOperations((code) => new Error(code));

function change90Days(values: ConsensusValues): string | null {
  if (values.epsAverage90DaysAgo === null) return null;
  const before = decimal.parseDecimal(values.epsAverage90DaysAgo, "eps_90d");
  if (!before.greaterThan(ZERO)) return null;
  const now = decimal.parseDecimal(values.epsAverage, "eps_average");
  return decimal.formatDecimal(
    decimal.divide(now, before, "change_90d").minus(ONE),
    "change_90d",
  );
}

function yearsAt(
  revisions: readonly ConsensusRevision[],
  knownAt: string,
): readonly ConsensusYearDetail[] {
  return consensusAt(revisions, knownAt).map((year) => ({
    ...year,
    change90Days: change90Days(year.values),
  }));
}

/**
 * The forward P/E block of a valuation (ADR 0083), read at request time and
 * never written into the run's snapshot: like the price comparison, it is a
 * market reading. Each historical close sees the consensus as known when its
 * session settled, so a later capture never reaches an earlier point.
 */
export async function loadForwardMultiples(
  input: {
    readonly securityId: string;
    readonly legalEntityId: string;
    readonly now: string;
  },
  dependencies: {
    readonly consensus: Pick<
      ConsensusRepository,
      "loadRevisions" | "captures" | "loadThresholds"
    >;
    readonly prices: Pick<PriceRepository, "loadSeries">;
  },
): Promise<ForwardMultiplesView> {
  const [revisions, captures, thresholds] = await Promise.all([
    dependencies.consensus.loadRevisions(input.securityId),
    dependencies.consensus.captures(input.securityId),
    dependencies.consensus.loadThresholds(input.legalEntityId, "forward_pe"),
  ]);
  const sorted = [...captures].sort((a, b) => Date.parse(a) - Date.parse(b));
  const firstCaptureAt = sorted[0] ?? null;
  const lastCaptureAt = lastAtOrBefore(sorted, input.now);
  const threshold =
    thresholds
      .filter((row) => Date.parse(row.declaredAt) <= Date.parse(input.now))
      .at(-1) ?? null;

  // The history starts at the first capture; today's reading also needs the
  // last close when it is older than that, to say how far apart they are.
  const firstDay =
    firstCaptureAt === null
      ? null
      : subtractDays(firstCaptureAt.slice(0, 10), CONSENSUS_STALE_AFTER_DAYS);
  const lookBack = subtractDays(
    input.now.slice(0, 10),
    LAST_CLOSE_LOOKBACK_DAYS,
  );
  const closes =
    firstDay === null
      ? []
      : await dependencies.prices.loadSeries({
          securityId: input.securityId,
          from: firstDay < lookBack ? firstDay : lookBack,
          to: null,
          limit: HISTORY_CLOSES_LIMIT,
        });
  const lastClose = closes.at(-1) ?? null;

  const yearsNow = yearsAt(revisions, input.now);
  const current = forwardPe({
    years: yearsNow.map((year) => ({
      periodEnd: year.periodEnd,
      epsAverage: year.values.epsAverage,
    })),
    capturedOn: lastCaptureAt?.slice(0, 10) ?? null,
    close:
      lastClose === null
        ? null
        : {
            marketDate: lastClose.marketDate,
            close: lastClose.close,
            currency: lastClose.currency,
          },
    consensusCurrency: CONSENSUS_CURRENCY,
  });

  const history: ForwardPePoint[] = [];
  for (const close of closes) {
    const knownAt = sessionSettledAt(close.marketDate);
    const capture = lastAtOrBefore(sorted, knownAt);
    if (capture === null) continue;
    const reading = forwardPe({
      years: yearsAt(revisions, knownAt).map((year) => ({
        periodEnd: year.periodEnd,
        epsAverage: year.values.epsAverage,
      })),
      capturedOn: capture.slice(0, 10),
      close: {
        marketDate: close.marketDate,
        close: close.close,
        currency: close.currency,
      },
      consensusCurrency: CONSENSUS_CURRENCY,
    });
    history.push({
      marketDate: close.marketDate,
      forwardPe: reading.forwardPe,
      reason: reading.forwardPeReason,
    });
  }

  return {
    current,
    // The consensus is shown by today's date, even when the P/E cannot be read.
    years: (() => {
      const ahead = fiscalYearsAhead(
        yearsNow.map((year) => ({
          periodEnd: year.periodEnd,
          epsAverage: year.values.epsAverage,
        })),
        input.now.slice(0, 10),
      );
      return ahead === null
        ? []
        : [ahead.fy1, ahead.fy2].map((year) =>
            yearsNow.find((row) => row.periodEnd === year.periodEnd)!,
          );
    })(),
    lastCaptureAt,
    firstCaptureAt,
    history,
    threshold: threshold?.value === null ? null : threshold,
  };
}
