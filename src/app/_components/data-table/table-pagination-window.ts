/**
 * Qué filas muestra una página. Puro: la página pedida se acota a las que
 * existen, así filtrar o achicar la lista nunca deja una página vacía.
 */
export type PageWindow = {
  /** Desde 1. */
  readonly page: number;
  /** Al menos 1, aunque no haya filas. */
  readonly pageCount: number;
  /** Índice de la primera fila, desde 0. */
  readonly start: number;
  /** Índice siguiente a la última fila mostrada. */
  readonly end: number;
  readonly total: number;
};

export function pageWindow(
  total: number,
  page: number,
  pageSize: number,
): PageWindow {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError(`page size must be a positive integer: ${pageSize}`);
  }
  const safeTotal = Math.max(0, Math.trunc(total));
  const pageCount = Math.max(1, Math.ceil(safeTotal / pageSize));
  const safePage = Number.isFinite(page)
    ? Math.min(Math.max(1, Math.trunc(page)), pageCount)
    : 1;
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pageCount,
    start,
    end: Math.min(start + pageSize, safeTotal),
    total: safeTotal,
  };
}
