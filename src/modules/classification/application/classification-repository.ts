import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import { taxonomyIdSchema } from "../domain/subject-classification";
import type { SubjectClassification } from "../domain/subject-classification";
import type { SectorClassificationPlan } from "../domain/plan-sector-classification";

/**
 * Lectura acotada de las clasificaciones de una taxonomía.
 *
 * El techo no es una comodidad: es la garantía de que una lectura no recorra la
 * tabla entera sin límite (`TM-07`). Superarlo es un error, no un truncado
 * silencioso —una población truncada en silencio es una matriz con empresas de
 * menos y nadie se entera—.
 */
export const classificationQuerySchema = z.object({
  taxonomyId: taxonomyIdSchema,
  limit: z.number().int().min(1).max(50_000).default(10_000),
});

export type ClassificationQuery = z.input<typeof classificationQuerySchema>;

export type SectorClassificationSummary = {
  readonly ruleVersion: string;
  readonly taxonomyId: string;
  readonly taxonomyVersion: string;
  readonly applied: {
    readonly opened: number;
    readonly superseded: number;
  };
  readonly unchanged: number;
  readonly rejected: number;
  readonly notReasserted: number;
};

export interface ClassificationRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Todas las aserciones de la taxonomía, vigentes o no: el planner las precisa. */
  loadClassifications(
    query: ClassificationQuery,
  ): Promise<readonly SubjectClassification[]>;
  /**
   * Aplica el plan en una transacción. Parcial no es una opción: abrir una
   * aserción sin superseder la que reemplaza dejaría dos vigentes para el mismo
   * sujeto en la misma taxonomía, que es exactamente lo que el índice único
   * declara imposible.
   */
  applySectorPlan(
    plan: SectorClassificationPlan,
  ): Promise<SectorClassificationSummary>;
}

type RepositoryFactories = {
  personal: () => ClassificationRepository;
};

export function selectClassificationRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): ClassificationRepository {
  return selectPersonalDependency(
    mode,
    "classification-repository",
    factories.personal,
  );
}
