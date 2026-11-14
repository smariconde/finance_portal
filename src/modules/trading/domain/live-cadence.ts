/**
 * Cada cuánto se relee la cuenta y cuándo una lectura deja de ser actual
 * (ADR 0076, sección 7; `F11-04`). Puras: el reloj llega inyectado.
 *
 * `schwab-live-cadence-1.0.0` (decisión del owner, 2026-11-13): con la página
 * visible y en la sesión regular de Nueva York, la cuenta cada 60 s y las
 * cotizaciones cada 15 s; fuera de sesión, las dos cada 5 minutos. Sin
 * calendario de feriados, como el resto del proyecto: un feriado se lee a la
 * cadencia de sesión y sólo cuesta pedidos. Medido: una lectura de la cuenta
 * son cuatro pedidos de ~0,5 s; con la página abierta todo el día son ~2.400
 * pedidos de `schwab-trader` y ~1.800 de `schwab-marketdata`, debajo de sus
 * topes de 3.000 y 2.000 y muy lejos de los 120 por minuto de Schwab.
 */
export const LIVE_CADENCE_VERSION = "schwab-live-cadence-1.0.0";
export const LIVE_FRESHNESS_VERSION = "live-reading-freshness-1.0.0";

export type LiveCadence = {
  readonly session: "regular" | "closed";
  readonly accountMs: number;
  readonly quotesMs: number;
};

const IN_SESSION: LiveCadence = Object.freeze({
  session: "regular",
  accountMs: 60_000,
  quotesMs: 15_000,
});

const OUT_OF_SESSION: LiveCadence = Object.freeze({
  session: "closed",
  accountMs: 300_000,
  quotesMs: 300_000,
});

const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;

const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** La sesión regular de Nueva York: lunes a viernes, 9:30 a 16:00 hora local. */
export function isNewYorkRegularSession(now: string): boolean {
  const parts = NEW_YORK.formatToParts(new Date(now));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = read("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minute = Number(read("hour")) * 60 + Number(read("minute"));
  return minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
}

export function liveCadence(now: string): LiveCadence {
  return isNewYorkRegularSession(now) ? IN_SESSION : OUT_OF_SESSION;
}

export type LiveFreshness =
  | { readonly light: "live" }
  | {
      readonly light: "stale";
      readonly reason: "refresh_failed" | "older_than_cadence";
    };

/**
 * `live-reading-freshness-1.0.0`: una lectura es LIVE si el último intento salió
 * bien y no tiene más de dos períodos de la cadencia vigente; si no, STALE con
 * el motivo. La página nunca presenta como actual una lectura vieja: la muestra
 * con su hora.
 */
export function liveFreshness(input: {
  readonly readAt: string;
  readonly now: string;
  readonly intervalMs: number;
  readonly lastAttemptFailed: boolean;
}): LiveFreshness {
  if (input.lastAttemptFailed) {
    return { light: "stale", reason: "refresh_failed" };
  }
  const age = Date.parse(input.now) - Date.parse(input.readAt);
  if (!Number.isFinite(age) || age > input.intervalMs * 2) {
    return { light: "stale", reason: "older_than_cadence" };
  }
  return { light: "live" };
}
