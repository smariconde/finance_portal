import {
  NYSE_CALENDAR,
  type MarketCalendarDeclaration,
} from "./declared-market-sessions";
import {
  addCalendarDays,
  BUENOS_AIRES,
  calendarDateIn,
  calendarDateMs,
  instantAt,
  isoWeekday,
  NEW_YORK,
  offsetMinutesAt,
  wallTimeIn,
} from "./zoned-time";

/**
 * Qué hace la bolsa de Nueva York en una fecha (`F12-01`, ADR 0088 decisión 2):
 * si opera, con qué horario regular y a qué hora es eso en Buenos Aires.
 *
 * - Sábado y domingo no opera; los feriados y cierres tempranos salen de la
 *   tabla declarada de la NYSE.
 * - Una fecha fuera de lo declarado es `undeclared`: no se supone hábil.
 * - La hora de Buenos Aires sale de `Intl`, así que el horario de verano de
 *   Estados Unidos (la Argentina no lo usa) mueve la apertura de las 11:30 a las
 *   10:30 sin una regla escrita acá.
 * - El horario extendido depende del broker y no se declara: lo dice Schwab.
 */
export const MARKET_SESSIONS_VERSION = "market-sessions-1.0.0";

const REGULAR_OPEN = "09:30";
const REGULAR_CLOSE = "16:00";

/** Faltando menos que esto para el final de lo declarado, la página lo avisa. */
const RENEWAL_NOTICE_DAYS = 365;

export type MarketDayStatus =
  "open" | "early_close" | "holiday" | "weekend" | "undeclared";

export type ZonedTime = {
  readonly instant: string;
  readonly newYork: string;
  readonly buenosAires: string;
};

export type MarketDay = {
  readonly date: string;
  /** 1 = lunes … 7 = domingo. */
  readonly weekday: number;
  readonly status: MarketDayStatus;
  /** Nombre oficial del feriado, o el motivo del cierre temprano. */
  readonly note: string | null;
  /** Sesión regular; `null` cuando no opera o no hay calendario. */
  readonly regular: {
    readonly open: ZonedTime;
    readonly close: ZonedTime;
  } | null;
};

function zoned(date: string, wallTime: string): ZonedTime {
  const instant = instantAt(date, wallTime, NEW_YORK);
  return {
    instant,
    newYork: wallTime,
    buenosAires: wallTimeIn(instant, BUENOS_AIRES),
  };
}

export function isTradingDay(day: MarketDay): boolean {
  return day.status === "open" || day.status === "early_close";
}

export function marketDayOf(
  date: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): MarketDay {
  const weekday = isoWeekday(date);
  const base = { date, weekday };

  if (weekday >= 6) {
    return { ...base, status: "weekend", note: null, regular: null };
  }
  if (date < calendar.coversFrom || date > calendar.coversTo) {
    return { ...base, status: "undeclared", note: null, regular: null };
  }

  const holiday = calendar.holidays.find((entry) => entry.date === date);
  if (holiday !== undefined) {
    return { ...base, status: "holiday", note: holiday.name, regular: null };
  }

  const early = calendar.earlyCloses.find((entry) => entry.date === date);
  return {
    ...base,
    status: early === undefined ? "open" : "early_close",
    note: early?.reason ?? null,
    regular: {
      open: zoned(date, REGULAR_OPEN),
      close: zoned(date, early?.regularClose ?? REGULAR_CLOSE),
    },
  };
}

/** Los días de `from` a `to`, ambos incluidos. */
export function marketDaysBetween(
  from: string,
  to: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): readonly MarketDay[] {
  const days: MarketDay[] = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    days.push(marketDayOf(date, calendar));
  }
  return days;
}

/**
 * La próxima fecha hábil después de `date`, o `null` si antes de encontrarla se
 * acaba lo declarado: después de eso no se supone nada.
 */
export function nextTradingDayAfter(
  date: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): MarketDay | null {
  for (let next = addCalendarDays(date, 1); ; next = addCalendarDays(next, 1)) {
    const day = marketDayOf(next, calendar);
    if (isTradingDay(day)) return day;
    if (day.status === "undeclared") return null;
  }
}

export type MarketPhase =
  /** Día hábil, antes de las 9:30 de Nueva York. */
  | "before_open"
  | "open"
  /** Día hábil, después del cierre regular (o del temprano). */
  | "after_close"
  /** Fin de semana o feriado. */
  | "closed_day"
  | "undeclared";

export type MarketMoment = {
  readonly version: typeof MARKET_SESSIONS_VERSION;
  readonly at: string;
  /** La sesión es la fecha de Nueva York, no la de Buenos Aires. */
  readonly today: MarketDay;
  readonly phase: MarketPhase;
  /** La próxima sesión que abre después de `at`, si está declarada. */
  readonly nextOpen: MarketDay | null;
};

export function marketMomentAt(
  instant: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): MarketMoment {
  const at = new Date(instant).toISOString();
  const today = marketDayOf(calendarDateIn(at, NEW_YORK), calendar);

  let phase: MarketPhase;
  if (today.status === "undeclared") phase = "undeclared";
  else if (today.regular === null) phase = "closed_day";
  else if (at < today.regular.open.instant) phase = "before_open";
  else if (at < today.regular.close.instant) phase = "open";
  else phase = "after_close";

  const nextOpen =
    phase === "before_open" ? today : nextTradingDayAfter(today.date, calendar);

  return { version: MARKET_SESSIONS_VERSION, at, today, phase, nextOpen };
}

/** Horas que Buenos Aires está adelante de Nueva York ese día (1 o 2). */
export function hoursAheadOfNewYork(date: string): number {
  const noon = calendarDateMs(date) + 12 * 3_600_000;
  return (
    (offsetMinutesAt(BUENOS_AIRES, noon) - offsetMinutesAt(NEW_YORK, noon)) / 60
  );
}

export type ClockShift = {
  /** El domingo en que Nueva York cambia de horario. */
  readonly date: string;
  readonly hoursAhead: number;
  /** La apertura regular en Buenos Aires desde ese cambio. */
  readonly openBuenosAires: string;
};

/**
 * El próximo cambio de la diferencia horaria entre Buenos Aires y Nueva York
 * dentro de `withinDays` días después de `date`, o `null`.
 */
export function nextClockShift(
  date: string,
  withinDays: number,
): ClockShift | null {
  const current = hoursAheadOfNewYork(date);
  for (let offset = 1; offset <= withinDays; offset += 1) {
    const candidate = addCalendarDays(date, offset);
    const hoursAhead = hoursAheadOfNewYork(candidate);
    if (hoursAhead !== current) {
      return {
        date: candidate,
        hoursAhead,
        openBuenosAires: zoned(candidate, REGULAR_OPEN).buenosAires,
      };
    }
  }
  return null;
}

export type CalendarCoverage = {
  readonly coversTo: string;
  readonly daysLeft: number;
  /** Falta menos de un año: hay que declarar el próximo anuncio de la NYSE. */
  readonly renewalDue: boolean;
};

export function calendarCoverage(
  today: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): CalendarCoverage {
  const daysLeft = Math.round(
    (calendarDateMs(calendar.coversTo) - calendarDateMs(today)) / 86_400_000,
  );
  return {
    coversTo: calendar.coversTo,
    daysLeft,
    renewalDue: daysLeft < RENEWAL_NOTICE_DAYS,
  };
}
