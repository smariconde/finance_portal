import { z } from "zod";

/**
 * Setups del diario (`trading-setups-1.0.0`, `F11-07`). Decisión del owner: una
 * base declarada acá más los suyos, guardados en la base de trading.
 *
 * - **Declarados:** los que van a enseñar las lecciones de `F11-10`, con un
 *   código estable para que cada lección se ate a su etiqueta. Cambiar un código
 *   es una versión nueva; agregar uno, también.
 * - **Propios:** `own-<slug>`, derivado del nombre que les pone el owner. El
 *   prefijo hace imposible que un propio pise un declarado.
 *
 * El nombre del setup va en inglés, que es como se lo busca y se lo enseña.
 */
export const TRADING_SETUPS_VERSION = "trading-setups-1.0.0";

export type TradingSetup = {
  readonly code: string;
  readonly label: string;
  readonly origin: "declared" | "own";
};

export const DECLARED_SETUPS: readonly TradingSetup[] = Object.freeze(
  (
    [
      ["breakout", "Breakout"],
      ["pullback", "Pullback"],
      ["opening_range_breakout", "Opening range breakout"],
      ["vwap_reclaim", "VWAP reclaim"],
      ["gap_and_go", "Gap and go"],
      ["support_bounce", "Support bounce"],
      ["moving_average_bounce", "Moving average bounce"],
      ["reversal", "Reversal"],
      ["earnings", "Earnings"],
    ] as const
  ).map(([code, label]) => ({ code, label, origin: "declared" as const })),
);

const DECLARED_CODES = new Set(DECLARED_SETUPS.map((setup) => setup.code));

export const OWN_SETUP_PREFIX = "own-";
export const MAX_OWN_SETUPS = 40;
const LABEL_MAX = 40;

/** Un código de setup bien formado, declarado o propio; si existe lo dice el catálogo. */
export const setupCodeSchema = z
  .string()
  .max(48)
  .regex(
    /^(?:[a-z][a-z0-9_]{1,40}|own-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/u,
  );

/** El nombre de un setup propio: texto corto de una línea, sin caracteres de control. */
export const ownSetupLabelSchema = z
  .string()
  .transform((value) => value.normalize("NFC").replace(/\s+/gu, " ").trim())
  .pipe(
    z
      .string()
      .min(2)
      .max(LABEL_MAX)
      // Letras, números, espacio y puntuación corriente; nada que se dibuje raro.
      .regex(/^[\p{L}\p{N} .,:;/&+()'#-]+$/u),
  );

/** `own-` y el nombre en minúsculas, sin acentos, con guiones. `null` si no queda nada. */
export function ownSetupCodeOf(label: string): string | null {
  const slug = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
  if (slug.length === 0) return null;
  const code = `${OWN_SETUP_PREFIX}${slug}`;
  return setupCodeSchema.safeParse(code).success ? code : null;
}

export function isDeclaredSetup(code: string): boolean {
  return DECLARED_CODES.has(code);
}

/** El catálogo que ve el owner: los declarados primero, después los suyos por nombre. */
export function setupCatalog(
  own: readonly { readonly code: string; readonly label: string }[],
): TradingSetup[] {
  return [
    ...DECLARED_SETUPS,
    ...[...own]
      .sort((a, b) => a.label.localeCompare(b.label, "es"))
      .map((setup) => ({ ...setup, origin: "own" as const })),
  ];
}
