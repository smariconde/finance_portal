/**
 * Horas de pared en una zona horaria, sin reglas de horario de verano escritas a
 * mano: el desplazamiento de cada instante sale de la base de zonas del runtime
 * (`Intl`), que es la que mantiene los cambios de Estados Unidos.
 */
export const NEW_YORK = "America/New_York";
export const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const OFFSET = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/u;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const wallFormatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  zone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      ...options,
    });
    cache.set(zone, formatter);
  }
  return formatter;
}

/** `2026-11-27` → milisegundos UTC de su medianoche; falla con otra forma. */
export function calendarDateMs(date: string): number {
  const match = CALENDAR_DATE.exec(date);
  const ms =
    match === null
      ? Number.NaN
      : Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new TypeError(`Not a calendar date: ${date}`);
  }
  return ms;
}

export function addCalendarDays(date: string, days: number): string {
  return new Date(calendarDateMs(date) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  const day = new Date(calendarDateMs(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Minutos que la zona está adelante de UTC en ese instante (Nueva York: −300 o −240). */
export function offsetMinutesAt(zone: string, ms: number): number {
  const name = cached(offsetFormatters, zone, {
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(ms))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name === undefined ? null : OFFSET.exec(name);
  if (match === null) throw new RangeError(`Unreadable offset for ${zone}`);
  if (match[1] === undefined) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * El instante de una hora de pared en una zona: `2026-11-27`, `13:00`, Nueva
 * York → `2026-11-27T18:00:00.000Z`. Las horas de mercado nunca caen en el hueco
 * ni en el doble del cambio de horario (que es a las 2:00 de un domingo).
 */
export function instantAt(
  date: string,
  wallTime: string,
  zone: string,
): string {
  const time = WALL_TIME.exec(wallTime);
  if (time === null) throw new TypeError(`Not a wall time: ${wallTime}`);
  const guess =
    calendarDateMs(date) + (Number(time[1]) * 60 + Number(time[2])) * 60_000;
  const first = offsetMinutesAt(zone, guess);
  let ms = guess - first * 60_000;
  const second = offsetMinutesAt(zone, ms);
  if (second !== first) ms = guess - second * 60_000;
  return new Date(ms).toISOString();
}

/** `HH:mm` de un instante en una zona, reloj de 24 horas. */
export function wallTimeIn(instant: string, zone: string): string {
  const parts = cached(wallFormatters, zone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${hour}:${minute}`;
}

/** La fecha de calendario de un instante en una zona. */
export function calendarDateIn(instant: string, zone: string): string {
  return cached(dateFormatters, zone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
