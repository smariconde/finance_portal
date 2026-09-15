import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { SuccessionRecordingPlan } from "../domain/plan-succession-recording";
import type {
  CorporateAction,
  LegalEntityRelationship,
} from "../domain/reporting-succession";

/**
 * Lectura acotada. Los vínculos entre entidades son pocos —uno por sucesión— y el
 * linaje se recorre en el dominio, así que se leen enteros con techo. Superarlo
 * es un error y no un truncado: un linaje al que le falta un vínculo uniría una
 * historia incompleta sin avisar (`TM-07`).
 */
export const corporateActionListQuerySchema = z.object({
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

export type CorporateActionListQuery = z.input<
  typeof corporateActionListQuerySchema
>;

export class CorporateActionListLimitError extends Error {
  readonly limit: number;

  constructor(resource: string, limit: number) {
    super(`The ${resource} list exceeds its limit of ${limit} rows.`);
    this.name = "CorporateActionListLimitError";
    this.limit = limit;
  }
}

export type SuccessionRecordingSummary = {
  readonly legalEntities: number;
  readonly identifierAssignments: number;
  readonly corporateActions: number;
  readonly relationships: number;
};

export interface CorporateActionRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Todas las versiones, también las cerradas: la historia se consulta al corte. */
  listRelationships(
    query?: CorporateActionListQuery,
  ): Promise<LegalEntityRelationship[]>;
  listCorporateActions(
    query?: CorporateActionListQuery,
  ): Promise<CorporateAction[]>;
  /**
   * Aplica el plan completo en una transacción: la entidad del antecesor, su CIK,
   * el evento y el vínculo. Un vínculo sin su antecesor, o un antecesor sin vínculo,
   * dejaría un grafo que el linaje no puede explicar.
   */
  applySuccessionPlan(
    plan: SuccessionRecordingPlan,
  ): Promise<SuccessionRecordingSummary>;
}

type RepositoryFactories = {
  personal: () => CorporateActionRepository;
};

export function selectCorporateActionRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): CorporateActionRepository {
  return selectPersonalDependency(mode, "corporate-action", factories.personal);
}

export function summarizeSuccessionPlan(
  plan: SuccessionRecordingPlan,
): SuccessionRecordingSummary {
  return {
    legalEntities: plan.legalEntities.length,
    identifierAssignments: plan.identifierAssignments.length,
    corporateActions: plan.corporateActions.length,
    relationships: plan.relationships.length,
  };
}
