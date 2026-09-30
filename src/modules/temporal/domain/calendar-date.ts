/**
 * Aritmética de fechas de calendario (`YYYY-MM-DD`), sin zona ni reloj.
 *
 * Nació en la ventana de historia de la SEC (`sec-history-5fy-1.0.0`) y se mudó
 * acá cuando las ventanas del Sortino (`sortino-1.0.0`) necesitaron la misma
 * regla: dos copias de "cinco años antes" podrían divergir en el 29 de febrero,
 * y dos ventanas del mismo proyecto terminarían cortando en días distintos.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function toUtcMs(date: string): number {
  const parsed = CALENDAR_DATE.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;

  if (
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) {
    throw new TypeError("Window dates must be calendar dates.");
  }

  return parsed;
}

/**
 * Misma fecha `years` años antes. Un 29 de febrero cae en el 28 de febrero de un
 * año no bisiesto, nunca en el 1 de marzo: correr el corte hacia adelante dejaría
 * afuera un cierre que entra.
 */
export function subtractCalendarYears(date: string, years: number): string {
  toUtcMs(date);

  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const targetYear = year - years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();

  return [
    String(targetYear).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}

export function subtractDays(date: string, days: number): string {
  return new Date(toUtcMs(date) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Días de calendario de `from` a `to`; negativo si `to` es anterior. */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}
