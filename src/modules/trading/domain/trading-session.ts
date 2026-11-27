import {
  NYSE_CALENDAR,
  type MarketCalendarDeclaration,
} from "@/modules/market-calendar/domain/declared-market-sessions";
import {
  marketDayOf,
  nextTradingDayAfter,
} from "@/modules/market-calendar/domain/market-sessions";

/**
 * La sesión de un instante (`trading-session-ny-1.0.0`, ADR 0076, sección 9): la
 * fecha calendario en `America/New_York`. Un day trade abre y cierra en la misma
 * sesión. Sin calendario de feriados: una ejecución siempre cae en un día hábil
 * de Schwab, y la fecha es la del reloj de Nueva York, no la de Buenos Aires ni
 * la UTC (una ejecución a las 21:30 de Buenos Aires puede ser del día anterior en
 * UTC y del mismo en Nueva York).
 */
export const TRADING_SESSION_VERSION = "trading-session-ny-1.0.0";

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `2026-11-13T21:05:00Z` → `2026-11-13` (16:05 en Nueva York). */
export function tradingSessionOf(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error("A trading session needs a valid instant.");
  }
  return NEW_YORK_DATE.format(date);
}

/**
 * La sesión que **prepara** un instante (`trading-session-ny-2.0.0`, ADR 0088
 * decisión 8): la de hoy en Nueva York si opera y su cierre regular —el
 * temprano incluido— todavía no pasó; si no, la próxima sesión declarada. Un
 * plan escrito el domingo, la noche anterior o en Thanksgiving es para la
 * próxima rueda, que `1.0.0` no sabía cuál era.
 *
 * Fuera de lo declarado rige `1.0.0`: no se supone un calendario. Las
 * ejecuciones se siguen fechando con `tradingSessionOf`, porque siempre caen
 * dentro de una sesión y su fecha de Nueva York ya es la correcta.
 */
export const PREPARED_SESSION_VERSION = "trading-session-ny-2.0.0";

export function preparedSessionOf(
  instant: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): string {
  const today = tradingSessionOf(instant);
  const day = marketDayOf(today, calendar);
  if (day.status === "undeclared") return today;
  if (
    day.regular !== null &&
    Date.parse(instant) < Date.parse(day.regular.close.instant)
  ) {
    return today;
  }
  return nextTradingDayAfter(today, calendar)?.date ?? today;
}

/**
 * Un plan registrado en `recordedAt` es de la sesión `session` si la fecha de
 * Nueva York coincide (`1.0.0`, que sigue valiendo para un plan escrito
 * después del cierre y operado en el post-market del mismo día) o si
 * `trading-session-ny-2.0.0` lo asigna a esa sesión. Los vínculos ya
 * guardados no se recalculan.
 */
export function planPreparesSession(
  recordedAt: string,
  session: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): boolean {
  return (
    tradingSessionOf(recordedAt) === session ||
    preparedSessionOf(recordedAt, calendar) === session
  );
}
