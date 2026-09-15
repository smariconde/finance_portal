import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { ListingReconciliationPlan } from "../domain/plan-listing-reconciliation";
import type { SplitRecordingPlan } from "../domain/plan-split-recording";
import type { SuccessionRecordingPlan } from "../domain/plan-succession-recording";
import {
  corporateActionTypeSchema,
  type CorporateAction,
  type LegalEntityRelationship,
} from "../domain/reporting-succession";

/**
 * Lectura acotada. Los vínculos entre entidades son pocos —uno por sucesión— y el
 * linaje se recorre en el dominio, así que se leen enteros con techo. Superarlo
 * es un error y no un truncado: un linaje al que le falta un vínculo uniría una
 * historia incompleta sin avisar (`TM-07`).
 */
export const corporateActionListQuerySchema = z.object({
  limit: z.number().int().min(1).max(10_000).default(2_000),
  /**
   * Sólo eventos de estos sujetos o de estas presentaciones. Los splits son uno o
   * dos por empresa, pero sobre el universo entero son cientos: una lectura por
   * emisor no tiene por qué traerlos todos. Los dos filtros se combinan con `o`,
   * porque el conflicto de una presentación puede venir de otro sujeto.
   */
  subjectIds: z.array(z.uuid()).min(1).max(64).optional(),
  sourceDocumentIds: z
    .array(z.string().trim().min(1).max(256))
    .min(1)
    .max(512)
    .optional(),
  actionTypes: z.array(corporateActionTypeSchema).min(1).optional(),
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

export type SplitRecordingSummary = {
  readonly corporateActions: number;
};

export type ListingReconciliationSummary = {
  readonly closures: number;
  readonly supersessions: number;
  readonly legalEntities: number;
  readonly listings: number;
  readonly listingSymbols: number;
  readonly corporateActions: number;
};

/**
 * La versión a cerrar o superseder ya no está vigente: el plan se construyó sobre
 * un grafo que cambió. La transacción se deshace entera.
 */
export class StaleListingPlanError extends Error {
  readonly level: string;
  readonly subjectId: string;

  constructor(level: string, subjectId: string) {
    super(`The ${level} version ${subjectId} is no longer open.`);
    this.name = "StaleListingPlanError";
    this.level = level;
    this.subjectId = subjectId;
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
  /** Inserta los splits planificados en una transacción; nunca reescribe uno. */
  applySplitPlan(plan: SplitRecordingPlan): Promise<SplitRecordingSummary>;
  /**
   * Cierra, supersede y abre en una transacción. Cerrar el listing viejo sin abrir
   * el nuevo dejaría a la security sin mercado; abrir sin cerrar, con dos tickers
   * vigentes. Una versión que ya no está abierta lanza `StaleListingPlanError`.
   */
  applyListingPlan(
    plan: ListingReconciliationPlan,
  ): Promise<ListingReconciliationSummary>;
}

export function summarizeListingPlan(
  plan: ListingReconciliationPlan,
): ListingReconciliationSummary {
  return {
    closures: plan.closures.length,
    supersessions: plan.supersessions.length,
    legalEntities: plan.legalEntities.length,
    listings: plan.listings.length,
    listingSymbols: plan.listingSymbols.length,
    corporateActions: plan.corporateActions.length,
  };
}

/**
 * Filtro compartido por memoria y PostgreSQL, para que las dos implementaciones
 * decidan igual qué evento entra en una lectura filtrada.
 */
export function matchesCorporateActionQuery(
  action: CorporateAction,
  query: z.infer<typeof corporateActionListQuerySchema>,
): boolean {
  if (
    query.actionTypes !== undefined &&
    !query.actionTypes.includes(action.actionType)
  ) {
    return false;
  }

  if (query.subjectIds === undefined && query.sourceDocumentIds === undefined) {
    return true;
  }

  return (
    (query.subjectIds?.includes(action.subjectId) ?? false) ||
    (query.sourceDocumentIds?.includes(action.sourceDocumentId) ?? false)
  );
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
