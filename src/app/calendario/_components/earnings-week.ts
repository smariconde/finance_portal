import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import {
  addCalendarDays,
  isoWeekday,
} from "@/modules/market-calendar/domain/zoned-time";

/**
 * Los earnings de `/calendario` por semana: cinco columnas de lunes a viernes
 * y, en cada una, lo que reporta antes de la apertura, después del cierre o
 * sin hora informada. Alpha Vantage sólo dice `pre-market` o `post-market`;
 * no da la hora, así que no se inventa una.
 */
export type EarningsSession = "before" | "after" | "unknown";

export type EarningsEntry = {
  readonly symbol: string;
  /** Una empresa que el owner sigue: valuada o con CEDEAR. */
  readonly followed: boolean;
  /** La fecha anterior, si la fuente la movió. */
  readonly previousDate: string | null;
};

export type EarningsWeekDay = {
  readonly date: string;
  readonly sessions: Readonly<
    Record<EarningsSession, readonly EarningsEntry[]>
  >;
};

export type EarningsWeek = {
  /** El lunes. */
  readonly start: string;
  readonly days: readonly EarningsWeekDay[];
  readonly total: number;
  /** Hay alguno sin hora: la fila sólo se dibuja entonces. */
  readonly hasUnknown: boolean;
};

type Report = EarningsCalendarView["reports"][number];

function sessionOf(time: Report["time"]): EarningsSession {
  if (time === "pre-market") return "before";
  if (time === "post-market") return "after";
  return "unknown";
}

/** El lunes de la semana de `date`. */
export function mondayOf(date: string): string {
  return addCalendarDays(date, 1 - isoWeekday(date));
}

/**
 * La primera semana a mostrar: la de hoy, o la siguiente si hoy es sábado o
 * domingo, porque la de hoy ya pasó entera.
 */
export function firstEarningsWeek(today: string): string {
  return isoWeekday(today) >= 6
    ? addCalendarDays(mondayOf(today), 7)
    : mondayOf(today);
}

/**
 * Las semanas navegables: de la primera hasta la del último reporte, nunca
 * antes de la primera. Sin reportes, sólo la primera.
 */
export function earningsWeekStarts(
  reports: readonly Pick<Report, "date">[],
  today: string,
): readonly string[] {
  const first = firstEarningsWeek(today);
  const last = reports.reduce((latest, report) => {
    const monday = mondayOf(report.date);
    return monday > latest ? monday : latest;
  }, first);
  const weeks: string[] = [];
  for (let monday = first; monday <= last; monday = addCalendarDays(monday, 7))
    weeks.push(monday);
  return weeks;
}

/** Primero las empresas seguidas, después por ticker. */
function byFollowedThenSymbol(left: EarningsEntry, right: EarningsEntry) {
  return (
    Number(right.followed) - Number(left.followed) ||
    left.symbol.localeCompare(right.symbol)
  );
}

export function earningsWeek(input: {
  readonly reports: readonly Report[];
  readonly start: string;
  readonly followed: readonly string[];
  readonly onlyFollowed: boolean;
}): EarningsWeek {
  const followed = new Set(input.followed);
  const dates = [0, 1, 2, 3, 4].map((offset) =>
    addCalendarDays(input.start, offset),
  );
  const buckets = new Map(
    dates.map((date) => [
      date,
      { before: [], after: [], unknown: [] } as Record<
        EarningsSession,
        EarningsEntry[]
      >,
    ]),
  );
  let total = 0;
  for (const report of input.reports) {
    const bucket = buckets.get(report.date);
    if (bucket === undefined) continue;
    const isFollowed = followed.has(report.symbol);
    if (input.onlyFollowed && !isFollowed) continue;
    bucket[sessionOf(report.time)].push({
      symbol: report.symbol,
      followed: isFollowed,
      previousDate:
        report.previousDate !== null && report.previousDate !== report.date
          ? report.previousDate
          : null,
    });
    total += 1;
  }
  const days = dates.map((date) => {
    const bucket = buckets.get(date)!;
    return {
      date,
      sessions: {
        before: bucket.before.sort(byFollowedThenSymbol),
        after: bucket.after.sort(byFollowedThenSymbol),
        unknown: bucket.unknown.sort(byFollowedThenSymbol),
      },
    };
  });
  return {
    start: input.start,
    days,
    total,
    hasUnknown: days.some((day) => day.sessions.unknown.length > 0),
  };
}
