import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

/**
 * How a long range of the Argentina charts reads a daily series and how two
 * points compare (`F9-13`). A month is read at its close, never averaged: the
 * value shown is one the source published, on a day the row names.
 */
export const MONTH_END_CLOSE_VERSION = "month-end-close-1.0.0";
export const POINT_CHANGE_VERSION = "point-change-1.0.0";

const decimal = createDecimalOperations((code) => new Error(code));

export type DatedValue = {
  readonly on: string;
  readonly value: string | null;
};

export type MonthEndValue = {
  /** First day of the month: the position on a monthly axis. */
  readonly on: string;
  /** The day the close was published, or `null` when the month has none. */
  readonly closeOn: string | null;
  readonly value: string | null;
};

export function monthOf(on: string): string {
  return `${on.slice(0, 7)}-01`;
}

export function shiftMonth(periodOn: string, months: number): string {
  const date = new Date(`${periodOn.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/** Months from `fromOn` to `toOn`, both first days, inclusive. */
export function monthsBetween(fromOn: string, toOn: string): string[] {
  const months: string[] = [];
  for (let on = monthOf(fromOn); on <= monthOf(toOn); on = shiftMonth(on, 1)) {
    months.push(on);
  }
  return months;
}

/**
 * The last published value of each calendar month, for every month between
 * the first and the last point (`month-end-close-1.0.0`). A month without one
 * stays `null`, so the line breaks there instead of joining its neighbours.
 * Points must be ordered by day.
 */
export function monthEndCloses(
  points: readonly DatedValue[],
): readonly MonthEndValue[] {
  const published = points.filter(
    (point): point is { on: string; value: string } => point.value !== null,
  );
  if (published.length === 0) return [];
  const last = new Map<string, { on: string; value: string }>();
  for (const point of published) last.set(monthOf(point.on), point);
  return monthsBetween(published[0]!.on, published.at(-1)!.on).map((on) => {
    const close = last.get(on);
    return {
      on,
      closeOn: close?.on ?? null,
      value: close?.value ?? null,
    };
  });
}

/**
 * How a change between two points is read: a level changes by its ratio
 * (`B / A − 1`); a rate, a share or a balance by its difference.
 */
export type ChangeKind = "ratio" | "difference";

export type PointChange =
  | { readonly status: "computed"; readonly value: string }
  | {
      readonly status: "unavailable";
      readonly reason: "missing_value" | "non_positive_base";
    };

/**
 * The change from `from` to `to` (`point-change-1.0.0`). A ratio needs a
 * strictly positive base: from a negative balance the ratio has no meaning.
 */
export function pointChange(
  from: string | null,
  to: string | null,
  kind: ChangeKind,
): PointChange {
  if (from === null || to === null) {
    return { status: "unavailable", reason: "missing_value" };
  }
  const a = decimal.parseDecimal(from, "from");
  const b = decimal.parseDecimal(to, "to");
  if (kind === "difference") {
    return {
      status: "computed",
      value: decimal.formatDecimal(b.minus(a), "change"),
    };
  }
  if (!a.greaterThan(0)) {
    return { status: "unavailable", reason: "non_positive_base" };
  }
  return {
    status: "computed",
    value: decimal.formatDecimal(
      decimal.divide(b, a, "change").minus(1),
      "change",
    ),
  };
}

/** Calendar days from `fromOn` to `toOn`. */
export function daysBetween(fromOn: string, toOn: string): number {
  return Math.round(
    (Date.parse(`${toOn}T00:00:00Z`) - Date.parse(`${fromOn}T00:00:00Z`)) /
      86_400_000,
  );
}
