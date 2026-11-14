import {
  createDecimalOperations,
  sum,
} from "@/modules/numeric/domain/decimal-policy";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import type { RoundTrip } from "./trade-round-trips";
import {
  initialRiskOf,
  inR,
  type PlannedStop,
  type RMultiple,
  type RMultipleReason,
} from "./trade-r-multiple";
import { tradingSessionOf } from "./trading-session";

/**
 * P&L realizado por sesión de Nueva York y sus totales (`trading-daily-pnl-1.0.0`,
 * `F11-06`).
 *
 * - **Por salida, no por trade.** Lo realizado de una sesión es lo que realizaron
 *   las salidas ejecutadas en ella (`trade-round-trip-fifo-1.1.0`): una salida
 *   parcial de un swing cuenta el día en que se vendió. Las salidas de un trade
 *   cerrado suman su P&L, así que el calendario reconcilia con el diario.
 * - **Sin entrada a la vista.** Una salida de un trade abierto antes de la
 *   historia no tiene P&L: se cuenta aparte (`unknownExits`) y la suma es la de
 *   las conocidas, nunca la de todas con un cero.
 * - **R.** Cada salida en R contra el riesgo inicial de su trade
 *   (`trade-r-multiple-1.0.0`). El total de un período en R existe sólo si todas
 *   sus salidas lo tienen; si no, `null` con el motivo de la primera que falta y
 *   cuántas faltan.
 * - **Semana** de lunes a viernes, entera aunque cruce de mes; **mes**, sus
 *   sesiones.
 */
export const DAILY_PNL_VERSION = "trading-daily-pnl-1.0.0";

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export type SessionExit = {
  readonly tradeId: string;
  readonly symbol: string;
  readonly session: string;
  readonly executedAt: string;
  /** `null` si el trade abrió antes de la historia. */
  readonly realizedPnl: string | null;
  readonly r: RMultiple;
  readonly dayTrade: boolean;
};

export type PeriodR =
  | { readonly value: string; readonly reason: null; readonly missing: 0 }
  | {
      readonly value: null;
      readonly reason: RMultipleReason;
      readonly missing: number;
    };

export type PeriodPnl = {
  readonly exits: number;
  /** Trades distintos con alguna salida en el período. */
  readonly trades: number;
  /** Suma de las salidas con P&L conocido. */
  readonly realizedPnl: string;
  readonly unknownExits: number;
  readonly r: PeriodR;
};

/** Las salidas de los trades, cada una con su sesión y su R. */
export function sessionExits(
  trades: readonly RoundTrip[],
  stops: ReadonlyMap<string, PlannedStop>,
): SessionExit[] {
  return trades
    .flatMap((trade) => {
      const risk = initialRiskOf(trade, stops.get(trade.tradeId) ?? null);
      return trade.portions
        .filter((portion) => portion.role === "close")
        .map((portion) => ({
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          session: tradingSessionOf(portion.executedAt),
          executedAt: portion.executedAt,
          realizedPnl: portion.realizedPnl,
          r: inR(portion.realizedPnl, risk),
          dayTrade: trade.dayTrade,
        }));
    })
    .sort(
      (a, b) =>
        Date.parse(a.executedAt) - Date.parse(b.executedAt) ||
        a.tradeId.localeCompare(b.tradeId),
    );
}

/** El total de un conjunto de salidas; `null` si no hay ninguna. */
export function periodPnl(exits: readonly SessionExit[]): PeriodPnl | null {
  if (exits.length === 0) return null;
  const path = "daily-pnl";
  const known = exits.filter((exit) => exit.realizedPnl !== null);
  const withoutR = exits.filter((exit) => exit.r.value === null);
  const firstWithoutR = withoutR[0];

  return {
    exits: exits.length,
    trades: new Set(exits.map((exit) => exit.tradeId)).size,
    realizedPnl: formatDecimal(
      sum(known.map((exit) => parseDecimal(exit.realizedPnl!, path))),
      path,
    ),
    unknownExits: exits.length - known.length,
    r:
      firstWithoutR === undefined
        ? {
            value: formatDecimal(
              sum(exits.map((exit) => parseDecimal(exit.r.value!, path))),
              path,
            ),
            reason: null,
            missing: 0,
          }
        : {
            value: null,
            reason: firstWithoutR.r.reason!,
            missing: withoutR.length,
          },
  };
}

function groupBy(
  exits: readonly SessionExit[],
  keyOf: (session: string) => string,
): Map<string, SessionExit[]> {
  const groups = new Map<string, SessionExit[]>();
  for (const exit of exits) {
    const key = keyOf(exit.session);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [exit]);
    else group.push(exit);
  }
  return groups;
}

/** Día de la semana de una fecha de calendario: 0 domingo, 1 lunes… */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** El lunes de la semana de una sesión. */
export function weekOf(session: string): string {
  return subtractDays(session, (weekdayOf(session) + 6) % 7);
}

export function monthOf(session: string): string {
  return session.slice(0, 7);
}

export type CalendarDay = {
  readonly session: string;
  /** Del mes que se muestra; los de los meses vecinos completan la semana. */
  readonly inMonth: boolean;
  readonly pnl: PeriodPnl | null;
};

export type CalendarWeek = {
  readonly monday: string;
  /** Lunes a viernes. */
  readonly days: readonly CalendarDay[];
  /** La semana entera, aunque cruce de mes. */
  readonly total: PeriodPnl | null;
};

export type TradingCalendar = {
  readonly month: string;
  readonly weeks: readonly CalendarWeek[];
  readonly total: PeriodPnl | null;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;

/** El calendario de un mes (`YYYY-MM`): sus semanas de lunes a viernes. */
export function tradingCalendar(
  month: string,
  exits: readonly SessionExit[],
): TradingCalendar {
  if (!MONTH.test(month)) throw new TypeError("A month is YYYY-MM.");
  const bySession = groupBy(exits, (session) => session);
  const byWeek = groupBy(exits, weekOf);
  const first = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0))
    .toISOString()
    .slice(0, 10);

  const weeks: CalendarWeek[] = [];
  for (
    let monday = weekOf(first);
    monday <= last;
    monday = subtractDays(monday, -7)
  ) {
    const days = [0, 1, 2, 3, 4].map((offset) => {
      const session = subtractDays(monday, -offset);
      return {
        session,
        inMonth: monthOf(session) === month,
        pnl: periodPnl(bySession.get(session) ?? []),
      };
    });
    // Un mes que empieza en sábado o domingo no tiene sesión en esa semana.
    if (!days.some((day) => day.inMonth)) continue;
    weeks.push({
      monday,
      days,
      total: periodPnl(byWeek.get(monday) ?? []),
    });
  }

  return {
    month,
    weeks,
    total: periodPnl(exits.filter((exit) => monthOf(exit.session) === month)),
  };
}

export type MonthTotal = {
  readonly month: string;
  readonly pnl: PeriodPnl | null;
};

/** Los doce meses de un año, con su total o `null` sin salidas. */
export function monthlyTotals(
  year: number,
  exits: readonly SessionExit[],
): MonthTotal[] {
  const byMonth = groupBy(exits, monthOf);
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
    return { month, pnl: periodPnl(byMonth.get(month) ?? []) };
  });
}

/** Lo realizado en una sesión; `null` si no hubo salidas. */
export function sessionPnl(
  session: string,
  exits: readonly SessionExit[],
): PeriodPnl | null {
  return periodPnl(exits.filter((exit) => exit.session === session));
}

export type CalendarYear = {
  readonly year: number;
  readonly months: readonly MonthTotal[];
  readonly total: PeriodPnl | null;
};

export type CalendarBook = {
  readonly today: { readonly session: string; readonly pnl: PeriodPnl | null };
  /** Del mes de la primera salida (o el de hoy) al de hoy, en orden. */
  readonly months: readonly TradingCalendar[];
  readonly years: readonly CalendarYear[];
};

/** Todo lo que el diario muestra por sesión, de la primera salida a hoy. */
export function calendarBook(
  exits: readonly SessionExit[],
  today: string,
): CalendarBook {
  const current = monthOf(today);
  const first = exits[0] === undefined ? current : monthOf(exits[0].session);
  const start = first < current ? first : current;

  const months: TradingCalendar[] = [];
  let [year, month] = start.split("-").map(Number) as [number, number];
  for (;;) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push(tradingCalendar(key, exits));
    if (key >= current) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const years = [
    ...new Set(months.map((calendar) => Number(calendar.month.slice(0, 4)))),
  ].map((value) => ({
    year: value,
    months: monthlyTotals(value, exits),
    total: periodPnl(
      exits.filter((exit) => exit.session.startsWith(`${value}-`)),
    ),
  }));

  return {
    today: { session: today, pnl: sessionPnl(today, exits) },
    months,
    years,
  };
}
