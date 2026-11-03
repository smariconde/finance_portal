/**
 * Estadísticas Monetarias v4 del BCRA (`F9-01`,
 * [ADR 0065](../../../../docs/architecture/adr/0065-bcra-monetary-catalog-vintages.md)).
 *
 * Las URLs se arman acá y sólo acá: la allowlist abre `/estadisticas/v4.0/`, y
 * un id de variable que no sea un entero positivo nunca llega a escribirse en
 * un path.
 */
export const BCRA_MONETARY_SOURCE_ID = "bcra-monetarias-v4";
export const BCRA_CATALOG_DATASET_ID = "bcra.monetary-catalog";
export const BCRA_OBSERVATIONS_DATASET_ID = "bcra.monetary-observations";
export const BCRA_MONETARY_PARSER_VERSION = "bcra-monetarias-v4-1.0.0";
export const BCRA_REVISION_WINDOW_VERSION = "bcra-revision-window-1.0.0";

export const BCRA_API_ORIGIN = "https://api.bcra.gob.ar";
export const BCRA_API_BASE_PATH = "/estadisticas/v4.0";

/** Límites medidos el 2026-11-02: el de datos es el máximo que la API acepta. */
export const CATALOG_PAGE_LIMIT = 1000;
export const METHODOLOGY_PAGE_LIMIT = 250;
export const SERIES_PAGE_LIMIT = 3000;

/** Techo de páginas por recurso: un `count` absurdo no abre un bucle. */
export const MAX_CATALOG_PAGES = 10;
export const MAX_METHODOLOGY_PAGES = 40;
export const MAX_SERIES_PAGES = 20;

/** Clave de la variable en el esquema de la fuente: su `idVariable`. */
export type BcraVariableId = number;

export function isBcraVariableId(value: unknown): value is BcraVariableId {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < 1_000_000
  );
}

function assertOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(`invalid page offset ${offset}`);
  }
}

export function catalogPageUrl(offset: number): string {
  assertOffset(offset);

  return `${BCRA_API_ORIGIN}${BCRA_API_BASE_PATH}/monetarias?offset=${offset}&limit=${CATALOG_PAGE_LIMIT}`;
}

/** La ruta medida es `Metodologia`, con mayúscula; el manual la escribe en minúscula. */
export function methodologyPageUrl(offset: number): string {
  assertOffset(offset);

  return `${BCRA_API_ORIGIN}${BCRA_API_BASE_PATH}/Metodologia?offset=${offset}&limit=${METHODOLOGY_PAGE_LIMIT}`;
}

/**
 * Una página de datos de la variable. Sin `desde` ni `hasta`: la API ordena de
 * la fecha más reciente a la más vieja, así que la página 0 es la ventana de
 * revisiones (`bcra-revision-window-1.0.0`) y las siguientes completan la
 * historia.
 */
export function seriesPageUrl(
  variableId: BcraVariableId,
  offset: number,
): string {
  if (!isBcraVariableId(variableId)) {
    throw new Error(`invalid BCRA variable id ${String(variableId)}`);
  }

  assertOffset(offset);

  return `${BCRA_API_ORIGIN}${BCRA_API_BASE_PATH}/monetarias/${variableId}?offset=${offset}&limit=${SERIES_PAGE_LIMIT}`;
}

/** Identidad estable de una serie en la base: fuente más id externo. */
export function bcraSeriesKey(variableId: BcraVariableId): string {
  return `${BCRA_MONETARY_SOURCE_ID}:${variableId}`;
}
