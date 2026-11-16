/**
 * Las partes de la base de trading que una lectura puede no tener todavía
 * (`F11-15`): cada una vino con su migración después de las transacciones
 * —anotaciones `0003`, reglas `0005`, plan antes de la rueda `0006`—, y una
 * base atrasada no debe tumbar la tarjeta entera. Sin la parte, la lectura usa
 * lo que rige sin ella (sin planes, las reglas por defecto) y la nombra.
 */
export type TradingPart = "annotations" | "risk_settings" | "pre_market";

/** SQLSTATE `undefined_table`: la tabla de una migración que no se aplicó. */
const UNDEFINED_TABLE = "42P01";

/** Si el error, o alguna de sus causas, es una tabla ausente. */
export function isUndefinedTable(error: unknown): boolean {
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof error !== "object" || error === null) return false;
    if ("code" in error && error.code === UNDEFINED_TABLE) return true;
    if (!("cause" in error)) return false;
    error = error.cause;
  }
  return false;
}

/**
 * Lee una parte; si su tabla no existe, anota la parte en `unread` y devuelve
 * `fallback`. Cualquier otra falla —conexión, permisos— sigue de largo.
 */
export async function readPart<T>(
  part: TradingPart,
  unread: Set<TradingPart>,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    unread.add(part);
    return fallback;
  }
}

const ORDER: readonly TradingPart[] = [
  "risk_settings",
  "pre_market",
  "annotations",
];

/** Las partes sin leer, en un orden estable para la tarjeta. */
export function unreadParts(unread: ReadonlySet<TradingPart>): TradingPart[] {
  return ORDER.filter((part) => unread.has(part));
}
