import { DECLARED_RISK_FREE_CURVES } from "../domain/risk-free-curves";
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

/**
 * Las curvas soberanas declaradas visibles al corte, por dataset (`F6-55`,
 * ADR 0087). Una sin release todavía es `null`: el costo de capital lo nombra.
 */
export async function readRiskFreeCurves(
  query: PointInTimeQuery,
  repository: ReferenceDatasetRepository,
): Promise<Readonly<Record<string, ReferenceDatasetReading | null>>> {
  const readings = await Promise.all(
    DECLARED_RISK_FREE_CURVES.map(
      async (curve) =>
        [
          curve.datasetId,
          await readReferenceDataset(curve.datasetId, query, repository),
        ] as const,
    ),
  );

  return Object.fromEntries(readings);
}
