/**
 * Lo que una matriz no dibuja, agrupado por motivo: con un sector sin
 * fundamentales, sesenta y nueve filas iguales («Sin ejercicio fiscal
 * guardado») tapaban la página. Un grupo es el motivo, cuántos son y quiénes.
 * Primero el motivo más frecuente; a igual cantidad, en orden alfabético, así
 * el orden no depende del de la base.
 */
export type MissingGroup<T> = {
  readonly reason: string;
  readonly items: readonly T[];
};

export function groupByReason<T>(
  items: readonly T[],
  reasonOf: (item: T) => string,
): readonly MissingGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const reason = reasonOf(item);
    const members = groups.get(reason);

    if (members === undefined) {
      groups.set(reason, [item]);
    } else {
      members.push(item);
    }
  }

  return [...groups.entries()]
    .map(([reason, members]) => ({ reason, items: members }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        left.reason.localeCompare(right.reason, "es"),
    );
}

/** Hasta cuántos tickers se muestran sin plegar en un grupo. */
export const INLINE_TICKERS = 12;
