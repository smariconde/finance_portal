import {
  formatAmount,
  formatCalendarDate,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";

/**
 * Cómo se escriben las cifras de la cuenta y del diario (Fase 11): dólares al
 * centavo, cantidades con los decimales que traen y horas de Buenos Aires en
 * 24 h. Decimales en texto, nunca `number`.
 */
const TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Una cantidad con los decimales que trae, hasta cuatro: fracciones de acción. */
export function formatQuantity(value: string): string {
  const decimals = value.includes(".") ? value.split(".")[1]!.length : 0;
  return formatAmount(value, { scale: Math.min(decimals, 4) });
}

export function formatMoney(value: string): string {
  return formatAmount(value, { scale: 2 });
}

export function formatSignedMoney(value: string): string {
  return formatSignedAmount(value, { scale: 2 });
}

export function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
}

/** `2026-11-09` → `09/11/2026`. */
export const formatSession = formatCalendarDate;

/** Signo de un decimal en texto, sin pasar por `number`. */
export function signOf(value: string): -1 | 0 | 1 {
  if (/^-?0(?:\.0+)?$/u.test(value)) return 0;
  return value.startsWith("-") ? -1 : 1;
}
