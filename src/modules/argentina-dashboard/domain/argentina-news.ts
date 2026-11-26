import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * What `/argentina` received since the owner's previous visit
 * (`argentina-news-1.0.0`, ADR 0079).
 *
 * Only releases that come by **period** are news: the EMAE, the CPI, the
 * primary result, goods trade and the REM round. A daily series (the dollar,
 * the gap, reserves, the ITCRM, soy) changes every business day and already
 * shows its date; marking it would mark it always.
 *
 * Both readings are of what **this installation had recorded**
 * (`system_recorded`): a source that is published one day and stored ten days
 * later is new on the day it was stored, which is when the owner could first
 * see it. Each metric compares its latest period with a value:
 *
 * - a later period than the baseline's, or a first period where there was
 *   none: `new_period`;
 * - the same period with another value: `revised`;
 * - otherwise `unchanged`. A latest period that went back (a withdrawn point)
 *   is not news either: the page already shows what remains.
 *
 * Without a baseline —the owner's first session— nothing is marked.
 */
export const ARGENTINA_NEWS_VERSION = "argentina-news-1.1.0";

/*
 * `1.1.0` (`F9-22`): a marked metric also carries the figure the page shows
 * for it —its **headline**— now and at the baseline, so a new period reads
 * next to the one the owner saw last and a revision reads as before → after.
 * What is marked does not change: it is still decided on the stored values.
 */

export const NEWS_METRICS = [
  "activity",
  "inflation",
  "remRound",
  "primaryBalance",
  "tradeBalance",
] as const;

export type NewsMetric = (typeof NEWS_METRICS)[number];

/**
 * The latest period of a metric with its value(s). A metric read from two
 * series (exports and imports) carries both, in a fixed order.
 */
export type NewsReading = {
  readonly on: string;
  readonly values: readonly string[];
  /**
   * The figure the page shows for this period, as a decimal in the metric's
   * own unit (the EMAE's monthly change in percent, the CPI in percent, the
   * trade balance in US$ M); `null` when there is none to show.
   */
  readonly headline: string | null;
};

export type NewsStatus =
  | {
      readonly status: "new_period";
      readonly on: string;
      readonly headline: string | null;
      /** The latest period the owner had seen, if any. */
      readonly previous: {
        readonly on: string;
        readonly headline: string | null;
      } | null;
    }
  | {
      readonly status: "revised";
      readonly on: string;
      readonly headline: string | null;
      /** The same period's figure at the baseline. */
      readonly previousHeadline: string | null;
    }
  | { readonly status: "unchanged" };

export type ArgentinaNews =
  | { readonly status: "no_baseline" }
  | {
      readonly status: "compared";
      readonly version: typeof ARGENTINA_NEWS_VERSION;
      /** The last view of the previous session. */
      readonly since: string;
      readonly metrics: Readonly<Record<NewsMetric, NewsStatus>>;
    };

const decimal = createDecimalOperations((code) => new Error(code));

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) =>
    decimal
      .parseDecimal(value, `news.current.${index}`)
      .equals(decimal.parseDecimal(b[index]!, `news.baseline.${index}`)),
  );
}

export function newsStatus(input: {
  readonly current: NewsReading | null;
  readonly baseline: NewsReading | null;
}): NewsStatus {
  const { current, baseline } = input;
  if (current === null) return { status: "unchanged" };
  if (baseline === null || current.on > baseline.on) {
    return {
      status: "new_period",
      on: current.on,
      headline: current.headline,
      previous:
        baseline === null
          ? null
          : { on: baseline.on, headline: baseline.headline },
    };
  }
  if (
    current.on === baseline.on &&
    !sameValues(current.values, baseline.values)
  ) {
    return {
      status: "revised",
      on: current.on,
      headline: current.headline,
      previousHeadline: baseline.headline,
    };
  }
  return { status: "unchanged" };
}

export function argentinaNews(input: {
  readonly since: string | null;
  readonly current: Readonly<Record<NewsMetric, NewsReading | null>>;
  readonly baseline: Readonly<Record<NewsMetric, NewsReading | null>>;
}): ArgentinaNews {
  if (input.since === null) return { status: "no_baseline" };
  const metrics = Object.fromEntries(
    NEWS_METRICS.map((metric) => [
      metric,
      newsStatus({
        current: input.current[metric],
        baseline: input.baseline[metric],
      }),
    ]),
  ) as Record<NewsMetric, NewsStatus>;
  return {
    status: "compared",
    version: ARGENTINA_NEWS_VERSION,
    since: input.since,
    metrics,
  };
}

type NewsPoint = { readonly on: string; readonly value: string | null };

/**
 * The latest period with a value, whatever the order of the points. Its
 * headline is the value itself unless the caller says otherwise.
 */
export function latestReading(
  points: readonly NewsPoint[],
): NewsReading | null {
  let latest: NewsReading | null = null;
  for (const point of points) {
    if (point.value === null) continue;
    if (latest === null || point.on > latest.on) {
      latest = { on: point.on, values: [point.value], headline: point.value };
    }
  }
  return latest;
}

/**
 * The latest period both series published, read together: a trade month is
 * new when its exports and imports are both there. Its headline is the
 * first minus the second (exports − imports: the balance).
 */
export function latestJointReading(
  first: readonly NewsPoint[],
  second: readonly NewsPoint[],
): NewsReading | null {
  const other = new Map<string, string>();
  for (const point of second) {
    if (point.value !== null) other.set(point.on, point.value);
  }
  let latest: NewsReading | null = null;
  for (const point of first) {
    const pair = other.get(point.on);
    if (point.value === null || pair === undefined) continue;
    if (latest === null || point.on > latest.on) {
      latest = {
        on: point.on,
        values: [point.value, pair],
        headline: decimal.formatDecimal(
          decimal
            .parseDecimal(point.value, "news.first")
            .minus(decimal.parseDecimal(pair, "news.second")),
          "news.balance",
        ),
      };
    }
  }
  return latest;
}
