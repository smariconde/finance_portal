import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  resolveReleaseAt,
  type ReferenceRelease,
  type ReferenceRow,
} from "../domain/reference-release";

import type { ReferenceDatasetRepository } from "./reference-dataset-repository";

export type ReferenceDatasetReading = {
  readonly release: ReferenceRelease;
  readonly rows: readonly ReferenceRow[];
};

/**
 * La release de un dataset visible al corte, con sus filas. `null` si ninguna se
 * conocía todavía: un costo de capital anterior a la primera observación no tiene
 * parámetros, y eso se nombra en vez de usar los de hoy (`TM-06`).
 */
export async function readReferenceDataset(
  datasetId: string,
  query: PointInTimeQuery,
  repository: ReferenceDatasetRepository,
): Promise<ReferenceDatasetReading | null> {
  const release = resolveReleaseAt(
    await repository.listReleases(datasetId),
    datasetId,
    query,
  );

  if (release === null) {
    return null;
  }

  return { release, rows: await repository.loadRows(release.releaseId) };
}
