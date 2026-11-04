import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import {
  PRESIDENTIAL_TERMS,
  type PresidentialTerm,
} from "./argentina-timeline";
import {
  monthEndCloses,
  monthOf,
  monthsBetween,
  shiftMonth,
  type DatedValue,
} from "./chart-history";

/**
 * Each presidency read from the day it took office (`F9-13`,
 * `government-comparison-1.0.0`), so two governments compare at the same
 * month of their term. It describes the path; it never attributes it.
 *
 * - Month `k = 0` is the base: the last close before the inauguration day for
 *   a daily series, the month before the inauguration month for a monthly one.
 * - Month `k = 1` is the inauguration month, which counts for the government
 *   that takes office; its last month is the one before the successor's
 *   inauguration month. Terms never share a month.
 * - `index`: `100 × value / base`, with a strictly positive base.
 * - `difference`: `value − base`, in the series' own unit.
 * - `cumulative_rate`: a monthly rate in percent chained from the base,
 *   `100 × Π(1 + rate / 100)`: the price level since taking office.
 * - `cumulative_sum`: monthly flows added from the inauguration month.
 *
 * A missing month is `null` in `index` and `difference`; in the two
 * cumulative bases it ends the path, because skipping it would chain over a
 * gap. Interim presidencies stay out.
 */
export const GOVERNMENT_COMPARISON_VERSION = "government-comparison-1.0.0";

const decimal = createDecimalOperations((code) => new Error(code));

/** Decimals kept in a compared point: geometry and reading, not storage. */
const OUTPUT_SCALE = 6;

export type ComparisonBasis =
  "index" | "difference" | "cumulative_rate" | "cumulative_sum";

export type GovernmentPoint = {
  /** Months since the base. */
  readonly month: number;
  /** The month on the calendar, first day. */
  readonly on: string;
  readonly value: string | null;
};

export type GovernmentPath =
  | {
      readonly termId: string;
      readonly status: "computed";
      /** The day or month the base was read at. */
      readonly baseOn: string;
      readonly baseValue: string;
      readonly points: readonly GovernmentPoint[];
      /** `true` while the term is running: its path is not complete. */
      readonly running: boolean;
    }
  | {
      readonly termId: string;
      readonly status: "unavailable";
      readonly reason:
        "interim" | "no_base" | "non_positive_base" | "no_points";
    };

function monthsOfTerm(
  term: PresidentialTerm,
  lastOn: string,
): readonly string[] {
  const first = monthOf(term.from);
  const last =
    term.to === null ? monthOf(lastOn) : shiftMonth(monthOf(term.to), -1);
  return last < first ? [] : monthsBetween(first, last);
}

function scaled(value: ReturnType<typeof decimal.parseDecimal>): string {
  return decimal.toFixedScale(value, OUTPUT_SCALE, "government-point");
}

export function compareGovernments(input: {
  readonly points: readonly DatedValue[];
  readonly frequency: "daily" | "monthly";
  readonly basis: ComparisonBasis;
  readonly terms?: readonly PresidentialTerm[];
}): readonly GovernmentPath[] {
  const terms = input.terms ?? PRESIDENTIAL_TERMS;
  const published = input.points.filter(
    (point): point is { on: string; value: string } => point.value !== null,
  );
  const lastOn = published.at(-1)?.on;
  const monthly = new Map(
    (input.frequency === "daily"
      ? monthEndCloses(input.points).map((close) => [close.on, close.value])
      : input.points.map((point) => [monthOf(point.on), point.value])) as [
      string,
      string | null,
    ][],
  );

  return terms.map((term): GovernmentPath => {
    if (term.kind === "interim") {
      return { termId: term.id, status: "unavailable", reason: "interim" };
    }
    // A monthly point is dated the first of its month, which the
    // inauguration month counts for the incoming term.
    const firstOn =
      input.frequency === "daily" ? term.from : monthOf(term.from);
    if (lastOn === undefined || lastOn < firstOn) {
      return { termId: term.id, status: "unavailable", reason: "no_points" };
    }

    const base =
      input.frequency === "daily"
        ? published.filter((point) => point.on < term.from).at(-1)
        : (() => {
            const on = shiftMonth(monthOf(term.from), -1);
            const value = monthly.get(on) ?? null;
            return value === null ? undefined : { on, value };
          })();
    const cumulative =
      input.basis === "cumulative_rate" || input.basis === "cumulative_sum";
    // A chained basis starts from 100 or 0, but still needs the series to
    // exist before the term: a path that starts mid-term is another path.
    if (base === undefined) {
      return { termId: term.id, status: "unavailable", reason: "no_base" };
    }
    const baseValue = decimal.parseDecimal(base.value, term.id);
    if (input.basis === "index" && !baseValue.greaterThan(0)) {
      return {
        termId: term.id,
        status: "unavailable",
        reason: "non_positive_base",
      };
    }

    const points: GovernmentPoint[] = [
      {
        month: 0,
        on: monthOf(base.on),
        value:
          input.basis === "index" || input.basis === "cumulative_rate"
            ? "100"
            : "0",
      },
    ];
    let running = cumulative
      ? input.basis === "cumulative_rate"
        ? decimal.parseDecimal("100", term.id)
        : decimal.parseDecimal("0", term.id)
      : null;

    for (const [index, on] of monthsOfTerm(term, lastOn).entries()) {
      const raw = monthly.get(on) ?? null;
      const month = index + 1;
      if (raw === null) {
        if (cumulative) break;
        points.push({ month, on, value: null });
        continue;
      }
      const value = decimal.parseDecimal(raw, on);
      switch (input.basis) {
        case "index":
          points.push({
            month,
            on,
            value: scaled(decimal.divide(value, baseValue, on).mul(100)),
          });
          break;
        case "difference":
          points.push({ month, on, value: scaled(value.minus(baseValue)) });
          break;
        case "cumulative_rate":
          running = running!.mul(value.div(100).plus(1));
          points.push({ month, on, value: scaled(running) });
          break;
        case "cumulative_sum":
          running = running!.plus(value);
          points.push({ month, on, value: scaled(running) });
          break;
      }
    }

    if (points.length === 1) {
      return { termId: term.id, status: "unavailable", reason: "no_points" };
    }
    return {
      termId: term.id,
      status: "computed",
      baseOn: base.on,
      baseValue: base.value,
      points,
      running: term.to === null,
    };
  });
}
