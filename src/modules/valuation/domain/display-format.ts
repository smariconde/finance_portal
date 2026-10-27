import {
  HUNDRED,
  parseDecimal,
  toFixedScale,
  type Dec,
} from "./decimal-policy";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Formato de presentación `es-AR` para valores del motor de valuación.
 *
 * Es determinista a propósito y **no** usa `Intl`: el mismo string debe salir
 * del render en el servidor y del navegador del owner, en cualquier host y
 * cualquier versión de ICU. Un separador que cambia entre entornos rompe la
 * hidratación y, peor, hace que dos lecturas del mismo número no coincidan.
 *
 * El valor mostrado es siempre una reducción del valor exacto: la superficie
 * conserva el decimal canónico junto al formateado cuando la diferencia importa
 * (`docs/valuation/methodology.md`, sección "Output y reproducibilidad").
 */
export const DISPLAY_LOCALE = "es-AR";
export const GROUP_SEPARATOR = ".";
export const DECIMAL_SEPARATOR = ",";

/** Escalas por defecto. Son convenciones de lectura, no política numérica. */
export const MONETARY_DISPLAY_SCALE = 2;
export const PERCENT_DISPLAY_SCALE = 2;
export const SHARE_DISPLAY_SCALE = 0;

function groupIntegerDigits(digits: string): string {
  let grouped = "";

  for (let index = digits.length; index > 0; index -= 3) {
    const start = Math.max(0, index - 3);
    const chunk = digits.slice(start, index);

    grouped = grouped === "" ? chunk : `${chunk}${GROUP_SEPARATOR}${grouped}`;
  }

  return grouped;
}

function localize(fixed: string): string {
  const negative = fixed.startsWith("-");
  const magnitude = negative ? fixed.slice(1) : fixed;
  const [integer, fraction] = magnitude.split(".");
  const localized =
    fraction === undefined
      ? groupIntegerDigits(integer)
      : `${groupIntegerDigits(integer)}${DECIMAL_SEPARATOR}${fraction}`;

  return negative ? `-${localized}` : localized;
}

function render(value: Dec, scale: number, path: string): string {
  return localize(toFixedScale(value, scale, path));
}

/** Decimal canónico → número agrupado en `es-AR`, sin unidad ni moneda. */
export function formatAmount(
  value: string,
  options: { scale?: number; path?: string } = {},
): string {
  const path = options.path ?? "display";

  return render(
    parseDecimal(value, path),
    options.scale ?? MONETARY_DISPLAY_SCALE,
    path,
  );
}

/** Igual que `formatAmount`, con signo explícito para deltas. */
export function formatSignedAmount(
  value: string,
  options: { scale?: number; path?: string } = {},
): string {
  const path = options.path ?? "display";
  const rendered = render(
    parseDecimal(value, path),
    options.scale ?? MONETARY_DISPLAY_SCALE,
    path,
  );
  // Un positivo que redondea a cero no se anuncia como `+0,00`: la escala
  // mostrada no alcanza para sostener esa dirección.
  const roundsToZero = new RegExp(`^0(?:${DECIMAL_SEPARATOR}0+)?$`, "u").test(
    rendered,
  );

  return rendered.startsWith("-") || roundsToZero ? rendered : `+${rendered}`;
}

/**
 * Tasa fraccional → puntos porcentuales. `0.09` es `9,00 %`. La multiplicación
 * ocurre en el motor decimal: `0.07 * 100` en punto flotante no da `7`.
 */
export function formatPercent(
  value: string,
  options: { scale?: number; path?: string } = {},
): string {
  const path = options.path ?? "display";

  return `${render(
    parseDecimal(value, path).times(HUNDRED),
    options.scale ?? PERCENT_DISPLAY_SCALE,
    path,
  )} %`;
}

/** Cantidad de acciones: sin decimales por defecto. */
export function formatShares(value: string, path = "display"): string {
  return render(parseDecimal(value, path), SHARE_DISPLAY_SCALE, path);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** `2024-12-31` → `31/12/2024`. El ISO original viaja en `<time dateTime>`. */
export function formatCalendarDate(value: string): string {
  const match = CALENDAR_DATE.exec(value);

  if (match === null) {
    throw new ValuationPolicyError(
      "invalid_decimal",
      "A calendar date must be an ISO `YYYY-MM-DD` value.",
      ["date"],
    );
  }

  const [, year, month, day] = match;

  return `${day}/${month}/${year}`;
}

const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z$/u;

/**
 * `2025-02-20T21:00:00.000Z` → `20/02/2025 21:00 UTC`.
 *
 * La zona se muestra y no se convierte: `available_at` es un hecho del contrato
 * point-in-time, no una hora local. Convertirlo a la zona del lector movería la
 * fecha de disponibilidad de un filing.
 */
export function formatUtcTimestamp(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);

  if (match === null) {
    throw new ValuationPolicyError(
      "invalid_decimal",
      "A timestamp must be an ISO UTC value ending in `Z`.",
      ["timestamp"],
    );
  }

  const [, year, month, day, hour, minute] = match;

  return `${day}/${month}/${year} ${hour}:${minute} UTC`;
}

/**
 * Hash abreviado para lectura. Nunca reemplaza al valor completo: la superficie
 * conserva el hash íntegro en el mismo elemento para poder copiarlo.
 */
export function shortenHash(hash: string, head = 8, tail = 4): string {
  return hash.length <= head + tail + 1
    ? hash
    : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Escalones de la lectura compacta: escala larga del castellano. */
const COMPACT_STEPS: readonly {
  readonly exponent: number;
  readonly word: string;
}[] = [
  { exponent: 12, word: "billones" },
  { exponent: 9, word: "mil millones" },
  { exponent: 6, word: "millones" },
];

/**
 * Monto grande en palabras para leerlo de un vistazo: `2644451815199.54` es
 * `2,64 billones`. Usa la escala larga —un billón es un millón de millones—,
 * que es la del castellano. Debajo del millón cae a `formatAmount`.
 *
 * Es una reducción: la cifra exacta queda en la tabla o el detalle.
 */
export function formatCompactAmount(
  value: string,
  options: { scale?: number; path?: string } = {},
): string {
  const path = options.path ?? "display";
  const amount = parseDecimal(value, path);
  const step = COMPACT_STEPS.find(({ exponent }) =>
    amount.abs().greaterThanOrEqualTo(`1e${exponent}`),
  );

  if (step === undefined) {
    return render(amount, options.scale ?? MONETARY_DISPLAY_SCALE, path);
  }

  const scaled = render(
    amount.dividedBy(`1e${step.exponent}`),
    options.scale ?? MONETARY_DISPLAY_SCALE,
    path,
  );
  // `1,00 billones` se lee mal: el singular sólo para exactamente uno.
  const word =
    scaled ===
      `1${DECIMAL_SEPARATOR}${"0".repeat(options.scale ?? MONETARY_DISPLAY_SCALE)}` &&
    step.word === "billones"
      ? "billón"
      : step.word;

  return `${scaled} ${word}`;
}

export type DisplayMagnitude = {
  /** Potencia de diez por la que se dividen los montos. */
  readonly exponent: 0 | 6 | 9 | 12;
  /** La unidad en palabras, para el título: «miles de millones». */
  readonly unit: string | null;
};

const MAGNITUDE_UNITS: Readonly<Record<6 | 9 | 12, string>> = {
  12: "billones",
  9: "miles de millones",
  6: "millones",
};

/**
 * Una sola magnitud para una serie, elegida por su mayor valor absoluto: las
 * cifras de un mismo gráfico se comparan en la misma unidad.
 */
export function displayMagnitude(values: readonly string[]): DisplayMagnitude {
  const largest = values.reduce(
    (max, value) => {
      const amount = parseDecimal(value, "magnitude").abs();
      return amount.greaterThan(max) ? amount : max;
    },
    parseDecimal("0", "magnitude"),
  );
  const step = COMPACT_STEPS.find(({ exponent }) =>
    largest.greaterThanOrEqualTo(`1e${exponent}`),
  );

  return step === undefined
    ? { exponent: 0, unit: null }
    : {
        exponent: step.exponent as 6 | 9 | 12,
        unit: MAGNITUDE_UNITS[step.exponent as 6 | 9 | 12],
      };
}

/** Un monto en la magnitud de su serie: `416161000000` en `9` es `416,2`. */
export function formatInMagnitude(
  value: string,
  magnitude: DisplayMagnitude,
  options: { scale?: number; path?: string } = {},
): string {
  const path = options.path ?? "display";

  return render(
    parseDecimal(value, path).dividedBy(`1e${magnitude.exponent}`),
    options.scale ?? 1,
    path,
  );
}
