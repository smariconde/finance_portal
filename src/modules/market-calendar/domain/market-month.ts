import {
  NYSE_CALENDAR,
  type MarketCalendarDeclaration,
} from "./declared-market-sessions";
import {
  marketDayOf,
  nextClockShift,
  type ClockShift,
  type MarketDay,
} from "./market-sessions";
import { addCalendarDays, isoWeekday } from "./zoned-time";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;

export type MarketMonthDay = MarketDay & { readonly inMonth: boolean };

export type MarketMonth = {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Semanas de lunes a viernes; los días de otro mes completan la semana. */
  readonly weeks: readonly (readonly MarketMonthDay[])[];
};

function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Las semanas hábiles de un mes, de lunes a viernes. */
export function marketMonth(
  month: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): MarketMonth {
  if (!MONTH.test(month)) throw new TypeError(`Not a month: ${month}`);
  const first = `${month}-01`;
  const last = lastDayOf(month);

  const weeks: MarketMonthDay[][] = [];
  let monday = addCalendarDays(first, 1 - isoWeekday(first));
  while (monday <= last) {
    const week: MarketMonthDay[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addCalendarDays(monday, offset);
      week.push({
        ...marketDayOf(date, calendar),
        inMonth: date.startsWith(month),
      });
    }
    // Un mes que empieza en sábado o domingo no abre con una semana vacía.
    if (week.some((day) => day.inMonth)) weeks.push(week);
    monday = addCalendarDays(monday, 7);
  }
  return { month, weeks };
}

/** Los meses que cubre la declaración, en orden. */
export function declaredMonths(
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): readonly string[] {
  const months: string[] = [];
  let [year, month] = calendar.coversFrom.split("-").map(Number) as [
    number,
    number,
  ];
  const end = calendar.coversTo.slice(0, 7);
  for (;;) {
    const label = `${year}-${String(month).padStart(2, "0")}`;
    months.push(label);
    if (label >= end) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

export type UpcomingMarketEvent =
  | {
      readonly kind: "holiday" | "early_close";
      readonly date: string;
      readonly day: MarketDay;
      readonly daysAway: number;
    }
  | {
      readonly kind: "clock_shift";
      readonly date: string;
      readonly shift: ClockShift;
      readonly daysAway: number;
    };

/**
 * Lo que cambia la rutina de las próximas semanas: feriados, cierres tempranos y
 * el cambio de horario de Nueva York, desde `today` (incluido) y dentro de
 * `withinDays`. No mira más allá de lo declarado.
 */
export function upcomingMarketEvents(
  today: string,
  withinDays: number,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): readonly UpcomingMarketEvent[] {
  const events: UpcomingMarketEvent[] = [];
  for (let offset = 0; offset <= withinDays; offset += 1) {
    const date = addCalendarDays(today, offset);
    if (date > calendar.coversTo) break;
    const day = marketDayOf(date, calendar);
    if (day.status === "holiday" || day.status === "early_close") {
      events.push({ kind: day.status, date, day, daysAway: offset });
    }
  }

  const shift = nextClockShift(today, withinDays);
  if (shift !== null) {
    events.push({
      kind: "clock_shift",
      date: shift.date,
      shift,
      daysAway: Math.round(
        (Date.parse(`${shift.date}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      ),
    });
  }

  return events.sort((left, right) => left.date.localeCompare(right.date));
}
