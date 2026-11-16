import type { Comparison } from "@/modules/macro-series/domain/argentina-indicator";
import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import {
  formatAmount,
  formatCalendarDate,
  formatCompactAmount,
  formatPercent,
  formatSignedAmount,
} from "@/modules/valuation/domain/display-format";

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const LONG_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** `2026-08-01` → `ago 2026`. */
export function shortMonth(periodOn: string): string {
  return `${MONTHS[Number(periodOn.slice(5, 7)) - 1]} ${periodOn.slice(0, 4)}`;
}

/** `2026-08-01` → `agosto de 2026`. */
export function longMonth(periodOn: string): string {
  return `${LONG_MONTHS[Number(periodOn.slice(5, 7)) - 1]} de ${periodOn.slice(0, 4)}`;
}

export const calendarDate = formatCalendarDate;

/**
 * Un valor ya en puntos porcentuales: `1.78` → `1,8 %`. El espacio antes del
 * `%` no separa: en una frase la cifra no queda sin su unidad al final de la
 * línea.
 */
export function points(value: string, scale = 1): string {
  return `${formatAmount(value, { scale })}\u00a0%`;
}

/** Igual, con signo: `-1.74` → `-1,7 %`, `0.07` → `+0,1 %`. */
export function signedPoints(value: string, scale = 1): string {
  return `${formatSignedAmount(value, { scale })}\u00a0%`;
}

/** Una fracción en puntos con signo: `0.0523` → `+5,2 %`, en el motor decimal. */
export function fractionAsPoints(value: string, scale = 1): string {
  const text = formatPercent(value, { scale });
  return text.startsWith("-") || /^0(?:,0+)? %$/u.test(text)
    ? text
    : `+${text}`;
}

export function amount(value: string, scale = 0): string {
  return formatAmount(value, { scale });
}

export function signedAmount(value: string, scale = 0): string {
  return formatSignedAmount(value, { scale });
}

const UNAVAILABLE: Record<
  Extract<Comparison, { status: "unavailable" }>["reason"],
  string
> = {
  missing_value: "Sin dato",
  incompatible_period: "Período incompleto",
  incompatible_basis: "Bases no comparables",
  incompatible_currency: "Monedas distintas",
  zero_denominator: "Base cero",
  non_finite: "No calculable",
};

/** Una lectura calculada en puntos con signo, o el motivo de su ausencia. */
export function comparisonText(
  comparison: Comparison,
  format: (value: string) => string = (value) => signedPoints(value),
): string {
  return comparison.status === "computed"
    ? format(comparison.value)
    : UNAVAILABLE[comparison.reason];
}

/** El número sólo para la geometría de un gráfico; la cifra leída es texto. */
export function plotNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const decimal = createDecimalOperations((code) => new Error(code));

/**
 * Un monto en millones, en palabras y sin signo: `12277684` es `12,3
 * billones`. El signo lo dice la frase («superávit», «déficit»); la cifra
 * exacta queda en la tabla.
 */
export function compactMillions(value: string): string {
  const pesos = decimal.parseDecimal(value, "millions").abs().mul(1_000_000);
  return formatCompactAmount(decimal.formatDecimal(pesos, "millions"), {
    scale: 1,
  });
}

/** `superávit` o `déficit` por el signo de un resultado. */
export function resultWord(value: string): "superávit" | "déficit" {
  return value.startsWith("-") ? "déficit" : "superávit";
}

/**
 * Un decimal redondeado a la escala que se muestra, para que la flecha y el
 * color de un cambio digan lo mismo que la cifra escrita: `0.04` a un
 * decimal es `0.0`, sin dirección.
 */
export function roundedTo(value: string, scale: number): string {
  return decimal.toFixedScale(
    decimal.parseDecimal(value, "rounded"),
    scale,
    "rounded",
  );
}

/** `2026-11-13` → `13/11`. */
export function dayMonth(on: string): string {
  return `${on.slice(8, 10)}/${on.slice(5, 7)}`;
}

/** Reescala una cifra sólo para el dibujo: la unidad la dice el título. */
export function plotScaled(
  value: string | null,
  divisor: number,
): number | null {
  const parsed = plotNumber(value);
  return parsed === null ? null : parsed / divisor;
}
