import {
  BCRA_CATALOG_DATASET_ID,
  BCRA_MONETARY_PARSER_VERSION,
  BCRA_MONETARY_SOURCE_ID,
  BCRA_OBSERVATIONS_DATASET_ID,
  BCRA_REVISION_WINDOW_VERSION,
  bcraSeriesKey,
} from "./bcra-monetary-source";

/**
 * Lo que distingue a una API del BCRA dentro del registro de series: su fuente,
 * sus datasets, sus versiones y cómo nombra una serie. El planeamiento de
 * definiciones y de puntos es el mismo para todas (ADR 0065, ADR 0067).
 */
export type BcraSourceProfile = {
  readonly sourceId: string;
  readonly catalogDatasetId: string;
  readonly observationsDatasetId: string;
  readonly parserVersion: string;
  readonly revisionWindowVersion: string;
  readonly seriesKeyOf: (externalId: number) => string;
};

export const BCRA_MONETARY_PROFILE: BcraSourceProfile = Object.freeze({
  sourceId: BCRA_MONETARY_SOURCE_ID,
  catalogDatasetId: BCRA_CATALOG_DATASET_ID,
  observationsDatasetId: BCRA_OBSERVATIONS_DATASET_ID,
  parserVersion: BCRA_MONETARY_PARSER_VERSION,
  revisionWindowVersion: BCRA_REVISION_WINDOW_VERSION,
  seriesKeyOf: bcraSeriesKey,
});
