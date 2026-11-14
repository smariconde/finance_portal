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
