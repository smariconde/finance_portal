import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import type { Comparison } from "@/modules/macro-series/domain/argentina-indicator";

import type {
  ActivityBlock,
  DollarBlock,
  ExternalBlock,
  MonetaryBlock,
} from "./argentina-dashboard";
import { shiftMonth } from "./chart-history";
import type { CountryRiskBlock } from "./country-risk-block";
import type { SoyBlock } from "./soy-block";

/**
 * How each summary tile of `/argentina` changed against its previous
 * published reading (`summary-change-1.0.0`, owner's request of 2026-11-16:
 * «que se entienda el cambio de cada métrica»).
 *
 * The change is the difference of the headline figure, never a ratio: every
 * headline is already a rate (a monthly change, a gap, a share of GDP) or a
 * balance that can cross zero, so its change reads in percentage points or
 * in the balance's own unit. The previous reading must be the period right
 * before the current one —the month before, the year before— or, for a daily
 * series, the latest earlier day that published; a gap in the series is a
 * reason, never a jump to an older reading.
 */
/**
 * `1.1.0` (owner's request of 2026-11-17): the country risk tile replaces the
 * primary result over GDP, an annual figure that changed once a year; its
 * change reads in basis points (`basis_points`).
 */
export const SUMMARY_CHANGE_VERSION = "summary-change-1.1.0";

/** How far back the previous reading may be. */
export type SummaryCadence = "daily" | "monthly" | "annual";

/**
 * What the headline is: `percent` is already in percent (`1.9` is 1,9 %),
 * `fraction` is a share (`0.071` is 7,1 %), `amount` is a level in its own
 * unit and `basis_points` a spread in basis points. A percent or a fraction
 * changes in percentage points; a spread, in basis points.
 */
export type SummaryBasis = "percent" | "fraction" | "amount" | "basis_points";

/** A headline reading: its date and its value, `null` when not published. */
export type SummaryReading = {
  readonly on: string;
  readonly value: string | null;
};

export type SummaryChange =
  | {
      readonly status: "computed";
      readonly currentOn: string;
      readonly previousOn: string;
      /** `current − previous`, in `unit`. */
      readonly difference: string;
      readonly unit: "pp" | "bp" | "amount";
      readonly version: typeof SUMMARY_CHANGE_VERSION;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        "missing_current" | "missing_previous" | "previous_not_adjacent";
    };

const decimal = createDecimalOperations((code) => new Error(code));

function adjacent(
  cadence: SummaryCadence,
  previousOn: string,
  currentOn: string,
): boolean {
  switch (cadence) {
    case "daily":
      return previousOn < currentOn;
    case "monthly":
      return previousOn.slice(0, 7) === shiftMonth(currentOn, -1).slice(0, 7);
    case "annual":
      return (
        Number(previousOn.slice(0, 4)) === Number(currentOn.slice(0, 4)) - 1
      );
  }
}

/** The difference between a headline and its previous reading. */
export function summaryChange(input: {
  readonly current: SummaryReading | null;
  readonly previous: SummaryReading | null;
  readonly cadence: SummaryCadence;
  readonly basis: SummaryBasis;
}): SummaryChange {
  const { current, previous, cadence, basis } = input;
  if (current === null || current.value === null) {
    return { status: "unavailable", reason: "missing_current" };
  }
  if (previous === null || previous.value === null) {
    return { status: "unavailable", reason: "missing_previous" };
  }
  if (!adjacent(cadence, previous.on, current.on)) {
    return { status: "unavailable", reason: "previous_not_adjacent" };
  }
  const difference = decimal
    .parseDecimal(current.value, "current")
    .minus(decimal.parseDecimal(previous.value, "previous"));
  return {
    status: "computed",
    currentOn: current.on,
    previousOn: previous.on,
    difference: decimal.formatDecimal(
      basis === "fraction" ? difference.mul(100) : difference,
      "difference",
    ),
    unit:
      basis === "amount" ? "amount" : basis === "basis_points" ? "bp" : "pp",
    version: SUMMARY_CHANGE_VERSION,
  };
}

/**
 * Which direction of a change reads as better for each tile. The arrow and
 * the sign always say the direction; the colour only reinforces it.
 */
export type SummaryPolarity =
  "higher_is_better" | "lower_is_better" | "neutral";

export type SummaryMetric =
  | "activity"
  | "fxGap"
  | "inflation"
  | "countryRisk"
  | "tradeBalance"
  | "soyGap";

/**
 * Declared per metric (owner's decision of 2026-11-16). The soy gap is
 * Rosario over Chicago minus one: less negative is more of Chicago's price
 * reaching the producer.
 */
export const SUMMARY_POLARITY: Readonly<
  Record<SummaryMetric, SummaryPolarity>
> = {
  activity: "higher_is_better",
  fxGap: "lower_is_better",
  inflation: "lower_is_better",
  countryRisk: "lower_is_better",
  tradeBalance: "higher_is_better",
  soyGap: "higher_is_better",
};

function computedValue(comparison: Comparison): string | null {
  return comparison.status === "computed" ? comparison.value : null;
}

function lastBefore<T extends { readonly on: string }>(
  items: readonly T[],
  on: string,
  has: (item: T) => boolean,
): T | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.on < on && has(item)) return item;
  }
  return null;
}

/** The change of every summary tile, read from the blocks as the page shows them. */
export function summaryChanges(blocks: {
  readonly activity: ActivityBlock;
  readonly dollar: DollarBlock;
  readonly monetary: MonetaryBlock;
  readonly countryRisk: CountryRiskBlock;
  readonly external: ExternalBlock;
  readonly soy: SoyBlock;
}): Readonly<Record<SummaryMetric, SummaryChange>> {
  const { activity, dollar, monetary, countryRisk, external, soy } = blocks;

  const latest = activity.latest;
  const activityChange = summaryChange({
    current: latest
      ? { on: latest.on, value: computedValue(latest.monthOverMonth) }
      : null,
    previous: latest
      ? {
          on: shiftMonth(latest.on, -1),
          value: computedValue(latest.previousMonthOverMonth),
        }
      : null,
    cadence: "monthly",
    basis: "percent",
  });

  const gap = dollar.latestGap;
  const previousGap = gap
    ? lastBefore(dollar.days, gap.on, (day) => day.gap !== null)
    : null;
  const fxGap = summaryChange({
    current: gap ? { on: gap.on, value: gap.gap } : null,
    previous: previousGap
      ? { on: previousGap.on, value: previousGap.gap }
      : null,
    cadence: "daily",
    basis: "fraction",
  });

  const inflation = summaryChange({
    current: monetary.monthlyInflation.at(-1) ?? null,
    previous: monetary.monthlyInflation.at(-2) ?? null,
    cadence: "monthly",
    basis: "percent",
  });

  const countryRiskChange = summaryChange({
    current: countryRisk.latest,
    previous: countryRisk.previous,
    cadence: "daily",
    basis: "basis_points",
  });

  const month = external.months.at(-1);
  const monthBefore = external.months.at(-2);
  const tradeBalance = summaryChange({
    current: month
      ? { on: month.on, value: computedValue(month.balance) }
      : null,
    previous: monthBefore
      ? { on: monthBefore.on, value: computedValue(monthBefore.balance) }
      : null,
    cadence: "monthly",
    basis: "amount",
  });

  const soyLatest = soy.latest;
  const soyBefore = soyLatest
    ? lastBefore(soy.days, soyLatest.on, (day) => day.basis !== null)
    : null;
  const soyGap = summaryChange({
    current: soyLatest ? { on: soyLatest.on, value: soyLatest.basis } : null,
    previous: soyBefore ? { on: soyBefore.on, value: soyBefore.basis } : null,
    cadence: "daily",
    basis: "percent",
  });

  return {
    activity: activityChange,
    fxGap,
    inflation,
    countryRisk: countryRiskChange,
    tradeBalance,
    soyGap,
  };
}
