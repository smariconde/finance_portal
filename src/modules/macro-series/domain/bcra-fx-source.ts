import type { BcraSourceProfile } from "./bcra-source-profile";

/**
 * Estadísticas Cambiarias v1 del BCRA (`F9-03`, ADR 0067): la cotización diaria
 * en pesos de cada moneda, publicada por el BCRA desde 1992-01-02.
 *
 * Ni el manual ni la página del BCRA dicen de qué mercado sale. Medido contra el
 * mayorista A3500 (variable 5) en 6.011 días: mediana 0,04 %, p95 0,67 %. No se
 * le atribuye otra metodología que la de «cotización publicada por el BCRA».
 */
export const BCRA_FX_SOURCE_ID = "bcra-cambiarias-v1";
export const BCRA_FX_CURRENCIES_DATASET_ID = "bcra.fx-currencies";
export const BCRA_FX_QUOTES_DATASET_ID = "bcra.fx-quotes";
export const BCRA_FX_PARSER_VERSION = "bcra-cambiarias-v1-1.0.0";
/** Una página: los 1.000 días más recientes, unos cuatro años. */
export const BCRA_FX_REVISION_WINDOW_VERSION = "bcra-fx-revision-window-1.0.0";

export const BCRA_FX_API_BASE =
  "https://api.bcra.gob.ar/estadisticascambiarias/v1.0";
/** La API rechaza fechas anteriores: es el comienzo del peso de 1992. */
export const BCRA_FX_FIRST_DATE = "1992-01-02";
/** Entre 10 y 1.000, según la API. */
export const BCRA_FX_PAGE_LIMIT = 1000;
export const MAX_FX_PAGES = 15;

/**
 * Las monedas que se descargan, declaradas en código (decisión del owner): el
 * dólar y los socios principales. La clave de la serie es el código ISO 4217
 * numérico, porque la de una serie macro es numérica.
 */
export type DeclaredFxCurrency = {
  readonly isoCode: string;
  readonly isoNumeric: number;
  readonly unit: string;
  /** Primer día que la API devolvió el 2026-11-03. */
  readonly firstReportedOn: string;
};

export const DECLARED_FX_CURRENCIES: readonly DeclaredFxCurrency[] =
  Object.freeze([
    {
      isoCode: "USD",
      isoNumeric: 840,
      unit: "Pesos argentinos por dólar estadounidense",
      firstReportedOn: "1992-01-02",
    },
    {
      isoCode: "EUR",
      isoNumeric: 978,
      unit: "Pesos argentinos por euro",
      firstReportedOn: "1999-01-04",
    },
    {
      isoCode: "BRL",
      isoNumeric: 986,
      unit: "Pesos argentinos por real",
      firstReportedOn: "1997-11-21",
    },
    {
      isoCode: "CNY",
      isoNumeric: 156,
      unit: "Pesos argentinos por yuan renminbi",
      firstReportedOn: "2006-01-02",
    },
  ]);

export function findDeclaredFxCurrency(
  isoNumeric: number,
): DeclaredFxCurrency | null {
  return (
    DECLARED_FX_CURRENCIES.find(
      (currency) => currency.isoNumeric === isoNumeric,
    ) ?? null
  );
}

export function bcraFxSeriesKey(isoNumeric: number): string {
  return `${BCRA_FX_SOURCE_ID}:${isoNumeric}`;
}

export function fxCurrenciesUrl(): string {
  return `${BCRA_FX_API_BASE}/Maestros/Divisas`;
}

/**
 * La API exige las dos fechas y rechaza un `fechahasta` posterior a su «día
 * actual», que es el de Buenos Aires: se pasa ese día, nunca el de UTC.
 */
export function fxQuotesUrl(
  isoCode: string,
  offset: number,
  untilOn: string,
): string {
  return `${BCRA_FX_API_BASE}/Cotizaciones/${isoCode}?fechadesde=${BCRA_FX_FIRST_DATE}&fechahasta=${untilOn}&limit=${BCRA_FX_PAGE_LIMIT}&offset=${offset}`;
}

/** El día de Buenos Aires (UTC−3, sin horario de verano desde 2009). */
export function buenosAiresDate(instant: string): string {
  return new Date(Date.parse(instant) - 3 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

export const BCRA_FX_PROFILE: BcraSourceProfile = Object.freeze({
  sourceId: BCRA_FX_SOURCE_ID,
  catalogDatasetId: BCRA_FX_CURRENCIES_DATASET_ID,
  observationsDatasetId: BCRA_FX_QUOTES_DATASET_ID,
  parserVersion: BCRA_FX_PARSER_VERSION,
  revisionWindowVersion: BCRA_FX_REVISION_WINDOW_VERSION,
  seriesKeyOf: bcraFxSeriesKey,
});
