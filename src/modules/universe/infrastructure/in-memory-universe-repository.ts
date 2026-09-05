import { identityGraphSchema } from "@/modules/identity/domain/identity-graph";

import {
  summarizePlan,
  universeStateQuerySchema,
  type UniverseRepository,
} from "../application/universe-repository";
import type { IndexMembership } from "../domain/index-membership";
import type {
  UniverseConstitutionPlan,
  UniverseState,
} from "../domain/plan-universe-constitution";

/**
 * Doble de test del repositorio de universo. No es un modo de ejecución: ninguna
 * raíz de composición lo construye, y su única razón de existir es que la regla
 * de constitución se pueda probar sin PostgreSQL (ADR 0004).
 *
 * Conserva las versiones cerradas igual que la tabla: un test que sólo mirara
 * las vigentes no notaría que la implementación borró historia.
 */
export function createInMemoryUniverseRepository(
  initial?: Partial<UniverseState>,
): UniverseRepository & { snapshot: () => UniverseState } {
  const graph = identityGraphSchema.parse({
    legalEntities: [],
    securities: [],
    listings: [],
    listingSymbols: [],
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [],
    ...initial?.graph,
  });
  const state = {
    legalEntities: [...graph.legalEntities],
    securities: [...graph.securities],
    listings: [...graph.listings],
    listingSymbols: [...graph.listingSymbols],
    depositaryPrograms: [...graph.depositaryPrograms],
    depositaryRatios: [...graph.depositaryRatios],
    identifierAssignments: [...graph.identifierAssignments],
    memberships: [...(initial?.memberships ?? [])] as IndexMembership[],
  };

  const isOpen = (version: { validTo: string | null }): boolean =>
    version.validTo === null;

  const snapshot = (): UniverseState => ({
    graph: {
      legalEntities: [...state.legalEntities],
      securities: [...state.securities],
      listings: [...state.listings],
      listingSymbols: [...state.listingSymbols],
      depositaryPrograms: [...state.depositaryPrograms],
      depositaryRatios: [...state.depositaryRatios],
      identifierAssignments: [...state.identifierAssignments],
    },
    memberships: [...state.memberships],
  });

  function applyClosures(plan: UniverseConstitutionPlan): void {
    for (const closure of plan.closures) {
      if (closure.level === "legal_entity") {
        const index = state.legalEntities.findIndex(
          (version) =>
            version.legalEntityId === closure.subjectId &&
            version.validFrom === closure.validFrom,
        );

        if (index >= 0) {
          state.legalEntities[index] = {
            ...state.legalEntities[index]!,
            validTo: closure.validTo,
          };
        }

        continue;
      }

      const index = state.memberships.findIndex(
        (membership) =>
          membership.indexMembershipId === closure.subjectId &&
          membership.validFrom === closure.validFrom,
      );

      if (index >= 0) {
        state.memberships[index] = {
          ...state.memberships[index]!,
          validTo: closure.validTo,
        };
      }
    }
  }

  return {
    storage: "in-memory-fixture",
    snapshot,
    async loadState(query) {
      const parsed = universeStateQuerySchema.parse(query);
      const current = snapshot();

      return {
        graph: {
          legalEntities: current.graph.legalEntities.filter(isOpen),
          securities: current.graph.securities.filter(isOpen),
          listings: current.graph.listings.filter(isOpen),
          listingSymbols: current.graph.listingSymbols.filter(isOpen),
          depositaryPrograms: current.graph.depositaryPrograms.filter(isOpen),
          depositaryRatios: current.graph.depositaryRatios.filter(isOpen),
          identifierAssignments:
            current.graph.identifierAssignments.filter(isOpen),
        },
        memberships: current.memberships.filter(
          (membership) => membership.indexId === parsed.indexId,
        ),
      };
    },
    async applyConstitution(plan) {
      applyClosures(plan);
      state.legalEntities.push(...plan.legalEntities);
      state.securities.push(...plan.securities);
      state.listings.push(...plan.listings);
      state.listingSymbols.push(...plan.listingSymbols);
      state.identifierAssignments.push(...plan.identifierAssignments);
      state.memberships.push(...plan.memberships);

      return summarizePlan(plan);
    },
  };
}
