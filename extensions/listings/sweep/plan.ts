/**
 * Qué visita el barrido de un portal en un día (`listing-sweep-1.0.0`). Puro:
 * recibe lo que la extensión sabe y devuelve la lista de páginas en orden,
 * nunca más que el tope.
 *
 * Prioridad (ADR 0089, Decisión 2):
 *
 * 1. **Seguidos**: las fichas que el owner marcó, todas las veces.
 * 2. **Búsquedas guardadas, primera página**, ordenadas por «más recientes»:
 *    lo nuevo aparece arriba.
 * 3. **Fichas sin revisar hace más de 7 días**, la más vieja primero, para
 *    confirmar que siguen publicadas y a qué precio.
 * 4. **Rotación**: lo que sobra se reparte entre páginas más profundas de las
 *    búsquedas (un tercio, con un cursor que avanza de un día a otro) y fichas
 *    que sólo se vieron en una tarjeta (el resto), que traen lo que la tarjeta
 *    no muestra.
 *
 * Una URL no se visita dos veces en el mismo día.
 */

/** El tope declarado; uno guardado sólo puede bajarlo. */
export const MAX_PAGES_PER_PORTAL_PER_DAY = 25;
export const STALE_DETAIL_DAYS = 7;
/** Páginas de rotación por búsqueda antes de volver a la segunda. */
export const MAX_ROTATION_PAGE = 60;

export type VisitReason =
  | "followed"
  | "search_first"
  | "stale_detail"
  | "search_rotation"
  | "undetailed";

export type RotationCursor = {
  /** Índice de la búsqueda guardada que rota. */
  readonly search: number;
  /** Próxima página profunda (empieza en 1: la 0 ya es prioridad 2). */
  readonly page: number;
};

export const INITIAL_ROTATION: RotationCursor = { search: 0, page: 1 };

export type PlannedVisit = {
  readonly url: string;
  readonly reason: VisitReason;
  /** Para `search_rotation`: el cursor después de visitarla. */
  readonly rotationAfter?: RotationCursor;
};

/** Lo que la extensión recuerda de un aviso que ya capturó. */
export type IndexedListing = {
  readonly url: string;
  /** Última vez que se leyó su ficha; `null` si sólo se vio en tarjetas. */
  readonly lastDetailAt: string | null;
  readonly lastSeenAt: string;
};

export type PlanInput = {
  readonly now: string;
  /** El tope efectivo: el guardado, nunca por encima del declarado. */
  readonly cap: number;
  readonly followed: readonly string[];
  /** Búsquedas guardadas, ya con «más recientes» y sin página. */
  readonly searches: readonly string[];
  readonly searchPageUrl: (search: string, page: number) => string;
  readonly index: readonly IndexedListing[];
  readonly rotation: RotationCursor;
};

export function effectiveCap(stored: number | null): number {
  if (stored === null || !Number.isInteger(stored) || stored < 0)
    return MAX_PAGES_PER_PORTAL_PER_DAY;
  return Math.min(stored, MAX_PAGES_PER_PORTAL_PER_DAY);
}

export function nextRotation(
  cursor: RotationCursor,
  searchCount: number,
): RotationCursor {
  if (searchCount === 0) return INITIAL_ROTATION;
  if (cursor.page + 1 > MAX_ROTATION_PAGE)
    return { search: (cursor.search + 1) % searchCount, page: 1 };
  return { search: cursor.search % searchCount, page: cursor.page + 1 };
}

/** Una página profunda vacía: la búsqueda se terminó, pasa a la siguiente. */
export function rotationAfterEmptyPage(
  cursor: RotationCursor,
  searchCount: number,
): RotationCursor {
  if (searchCount === 0) return INITIAL_ROTATION;
  return { search: (cursor.search + 1) % searchCount, page: 1 };
}

export function planSweep(input: PlanInput): readonly PlannedVisit[] {
  const cap = effectiveCap(input.cap);
  const visits: PlannedVisit[] = [];
  const seen = new Set<string>();
  const push = (visit: PlannedVisit) => {
    if (visits.length >= cap || seen.has(visit.url)) return;
    seen.add(visit.url);
    visits.push(visit);
  };

  for (const url of input.followed) push({ url, reason: "followed" });
  for (const search of input.searches)
    push({ url: input.searchPageUrl(search, 0), reason: "search_first" });

  const staleBefore = Date.parse(input.now) - STALE_DETAIL_DAYS * 86_400_000;
  const stale = input.index
    .filter(
      (listing) =>
        listing.lastDetailAt !== null &&
        Date.parse(listing.lastDetailAt) < staleBefore,
    )
    .sort((a, b) => Date.parse(a.lastDetailAt!) - Date.parse(b.lastDetailAt!));
  for (const listing of stale)
    push({ url: listing.url, reason: "stale_detail" });

  const remaining = cap - visits.length;
  if (remaining <= 0) return visits;

  const undetailed = input.index
    .filter((listing) => listing.lastDetailAt === null)
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  let deepSlots =
    input.searches.length === 0
      ? 0
      : undetailed.length === 0
        ? remaining
        : Math.ceil(remaining / 3);

  let cursor = input.rotation;
  const searchCount = input.searches.length;
  let guard = 0;
  while (
    deepSlots > 0 &&
    visits.length < cap &&
    guard < MAX_ROTATION_PAGE * 2
  ) {
    guard += 1;
    const search = input.searches[cursor.search % searchCount];
    const after = nextRotation(cursor, searchCount);
    const before = visits.length;
    push({
      url: input.searchPageUrl(search, cursor.page),
      reason: "search_rotation",
      rotationAfter: after,
    });
    if (visits.length > before) deepSlots -= 1;
    cursor = after;
  }

  for (const listing of undetailed)
    push({ url: listing.url, reason: "undetailed" });
  return visits;
}
