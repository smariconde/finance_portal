import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  ReferenceRelease,
  ReferenceRow,
  ReleasePlan,
} from "../domain/reference-release";

/** Techo de releases por dataset: una por observación con cambios, años de margen. */
export const MAX_RELEASES_PER_DATASET = 1000;

export type OpenedReleasePlan = Extract<ReleasePlan, { status: "opened" }>;

export interface ReferenceDatasetRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Todas las releases del dataset, vigentes o no: la lectura al corte filtra. */
  listReleases(datasetId: string): Promise<readonly ReferenceRelease[]>;
  loadRows(releaseId: string): Promise<readonly ReferenceRow[]>;
  /**
   * Supersede la vigente y abre la nueva con sus filas en una transacción:
   * partida, el índice único dejaría el dataset sin release vigente o con dos.
   */
  applyReleasePlan(plan: OpenedReleasePlan): Promise<void>;
}

export function selectReferenceDatasetRepository(
  mode: AppMode,
  factories: { personal: () => ReferenceDatasetRepository },
): ReferenceDatasetRepository {
  return selectPersonalDependency(
    mode,
    "reference-dataset-repository",
    factories.personal,
  );
}
