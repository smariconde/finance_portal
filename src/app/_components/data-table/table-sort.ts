/**
 * El orden de una tabla: qué columna y hacia dónde. Puro para que se pruebe sin
 * React; `SortableTableHead` lo dibuja con `aria-sort`.
 */
export type SortDirection = "ascending" | "descending";

export type SortState<K extends string> = {
  readonly key: K;
  readonly direction: SortDirection;
};

/**
 * Click en una columna: la misma invierte el sentido; otra arranca en el que
 * declara (texto de A a Z, cifras de mayor a menor).
 */
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  firstDirection: SortDirection,
): SortState<K> {
  if (current.key !== key) return { key, direction: firstDirection };
  return {
    key,
    direction: current.direction === "ascending" ? "descending" : "ascending",
  };
}

/**
 * Compara dos valores que pueden faltar: lo que no tiene la cifra va siempre
 * al final, en los dos sentidos, así ordenar nunca lo confunde con un cero.
 */
export function compareNullsLast<T>(
  left: T | null,
  right: T | null,
  direction: SortDirection,
  compare: (left: T, right: T) => number,
): number {
  if (left === null || right === null) {
    return Number(left === null) - Number(right === null);
  }
  const order = compare(left, right);
  return direction === "ascending" ? order : -order;
}

/**
 * Ordena un decimal en texto. El `Number` sólo decide el orden; la cifra que
 * se lee sigue siendo el decimal exacto.
 */
export function compareDecimalText(left: string, right: string): number {
  return Number(left) - Number(right);
}
