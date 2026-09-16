import type {
  CompanyTickerAssignment,
  IndexConstituentClaim,
} from "../domain/universe-source-records";

/**
 * Corpus sintético del universo, en la **forma** de las dos fuentes reales.
 *
 * Ninguna empresa existe y ningún CIK está asignado: los valores viven en el
 * rango `99xxxxx`, que la SEC no usa para filers reales. No deriva de ningún
 * payload descargado, así que este archivo no publica datos de terceros en un
 * repositorio público. Los extractos reales congelados llegan en `F2-06`.
 *
 * El corpus está armado para que cada caso difícil de la constitución tenga un
 * ejemplo y no dependa de que una empresa real se comporte así:
 *
 * - `NORTHWIND` cotiza dos clases con el mismo CIK: un emisor, dos securities;
 * - `PAMPA.B` en la lista es `PAMPA-B` en la SEC: misma asignación escrita en
 *   dos convenciones de separador;
 * - `RIACHUELO` cotiza OTC, un mercado sin MIC único: rechazo, no venue
 *   inventado;
 * - `QUILMES` está en la lista pero no en la tabla de asignaciones: sin emisor
 *   autoritativo no hay identidad;
 * - `SALADILLO` aparece con dos CIK distintos: conflicto, no desempate.
 *
 * Cambiar un registro obliga a subir `FIXTURE_UNIVERSE_VERSION`.
 */
export const FIXTURE_UNIVERSE_VERSION = "2026-09-04.1";

export const FIXTURE_INDEX_ID = "fixture-index";
export const FIXTURE_UNIVERSE_SOURCE_ID = "fixture-demo";
export const FIXTURE_UNIVERSE_DOCUMENT = "fixture-index-constituents";

export const FIXTURE_CONSTITUENT_CLAIMS: readonly IndexConstituentClaim[] =
  Object.freeze([
    { symbol: "ANDES", name: "Andes Synthetic Corp", sector: "Industrials" },
    { symbol: "NWND", name: "Northwind Synthetic Inc", sector: "Technology" },
    { symbol: "NWNDA", name: "Northwind Synthetic Inc", sector: "Technology" },
    { symbol: "PAMPA.B", name: "Pampa Synthetic Holdings", sector: "Energy" },
    { symbol: "RIACH", name: "Riachuelo Synthetic Co", sector: "Materials" },
    { symbol: "QUILM", name: "Quilmes Synthetic SA", sector: "Consumer" },
    { symbol: "SALAD", name: "Saladillo Synthetic Ltd", sector: "Utilities" },
  ]);

export const FIXTURE_TICKER_ASSIGNMENTS: readonly CompanyTickerAssignment[] =
  Object.freeze([
    {
      cik: "9900001",
      name: "Andes Synthetic Corp",
      ticker: "ANDES",
      exchange: "Nasdaq",
    },
    {
      cik: "9900002",
      name: "Northwind Synthetic Inc",
      ticker: "NWND",
      exchange: "Nasdaq",
    },
    {
      // Misma entidad legal, otra clase: dos instrumentos, un solo CIK.
      cik: "9900002",
      name: "Northwind Synthetic Inc",
      ticker: "NWNDA",
      exchange: "Nasdaq",
    },
    {
      cik: "9900003",
      name: "Pampa Synthetic Holdings",
      ticker: "PAMPA-B",
      exchange: "NYSE",
    },
    {
      cik: "9900004",
      name: "Riachuelo Synthetic Co",
      ticker: "RIACH",
      exchange: "OTC",
    },
    {
      cik: "9900005",
      name: "Saladillo Synthetic Ltd",
      ticker: "SALAD",
      exchange: "NYSE",
    },
    {
      cik: "9900006",
      name: "Saladillo Synthetic Holdings",
      ticker: "SALAD",
      exchange: "Nasdaq",
    },
  ]);

/** Los cuatro símbolos que la constitución sí puede resolver. */
export const FIXTURE_RESOLVABLE_SYMBOLS = Object.freeze([
  "ANDES",
  "NWND",
  "NWNDA",
  "PAMPA-B",
]);
