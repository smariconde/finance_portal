import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import { indexIdSchema } from "../domain/index-membership";
import type {
  PlanRejection,
  UniverseConstitutionPlan,
  UniverseState,
} from "../domain/plan-universe-constitution";

/**
 * Lectura acotada del estado del universo. El planner necesita el grafo abierto
 * completo para no duplicar identidades, así que el límite no es un filtro de
 * conveniencia: es la garantía de que una constitución no recorra la tabla
 * entera sin techo (`TM-07`). Superarlo es un error, no un truncado silencioso.
 */
export const universeStateQuerySchema = z.object({
  indexId: indexIdSchema,
  limit: z.number().int().min(1).max(50_000).default(10_000),
});

export type UniverseStateQuery = z.input<typeof universeStateQuerySchema>;

export type UniverseConstitutionSummary = {
  readonly ruleVersion: string;
  readonly matchRuleVersion: string;
  readonly indexId: string;
  readonly effectiveAt: string;
  readonly applied: {
    readonly legalEntities: number;
    readonly securities: number;
    readonly listings: number;
    readonly listingSymbols: number;
    readonly identifierAssignments: number;
    readonly memberships: number;
    readonly closures: number;
  };
  readonly members: number;
  readonly rejections: readonly PlanRejection[];
};

export interface UniverseRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Versiones abiertas del grafo más las membresías del índice pedido. */
  loadState(query: UniverseStateQuery): Promise<UniverseState>;
  /**
   * Aplica el plan completo en una transacción. Parcial no es una opción: abrir
   * versiones sin cerrar las que reemplazan dejaría dos vigentes para el mismo
   * sujeto, que es el estado que el contrato point-in-time declara imposible.
   */
  applyConstitution(
    plan: UniverseConstitutionPlan,
  ): Promise<UniverseConstitutionSummary>;
}

type RepositoryFactories = {
  personal: () => UniverseRepository;
};

export function selectUniverseRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): UniverseRepository {
  return selectPersonalDependency(mode, "universe", factories.personal);
}

/**
 * Identidad de cache de una lectura derivada del universo. El modo forma parte
 * de la clave, así que un runtime trabado nunca puede leer una entrada personal
 * (`TM-04`).
 */
export function createUniverseCacheIdentity(
  mode: AppMode,
  indexId: string,
  effectiveAt: string,
): readonly ["universe", AppMode, string, string] {
  return [
    "universe",
    mode,
    indexIdSchema.parse(indexId),
    z.iso.datetime({ offset: true }).parse(effectiveAt),
  ];
}

export function summarizePlan(
  plan: UniverseConstitutionPlan,
): UniverseConstitutionSummary {
  return {
    ruleVersion: plan.ruleVersion,
    matchRuleVersion: plan.matchRuleVersion,
    indexId: plan.indexId,
    effectiveAt: plan.effectiveAt,
    applied: {
      legalEntities: plan.legalEntities.length,
      securities: plan.securities.length,
      listings: plan.listings.length,
      listingSymbols: plan.listingSymbols.length,
      identifierAssignments: plan.identifierAssignments.length,
      memberships: plan.memberships.length,
      closures: plan.closures.length,
    },
    members: plan.counts.members,
    rejections: plan.rejections,
  };
}
