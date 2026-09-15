import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  CorporateActionListLimitError,
  corporateActionListQuerySchema,
  summarizeSuccessionPlan,
  type CorporateActionRepository,
} from "../application/corporate-action-repository";
import type {
  CorporateAction,
  LegalEntityRelationship,
} from "../domain/reporting-succession";

/**
 * Doble de test del repositorio de corporate actions. No es un modo de ejecución:
 * ninguna raíz de composición lo construye (ADR 0004).
 *
 * Guarda también el grafo de identidad, porque aplicar una sucesión escribe la
 * entidad del antecesor y su CIK en la misma transacción que el vínculo; el test
 * lee ese grafo con `loadIdentityGraph` igual que el job lee el persistido.
 */
export function createInMemoryCorporateActionRepository(initial?: {
  readonly graph?: Partial<IdentityGraph>;
  readonly relationships?: readonly LegalEntityRelationship[];
  readonly corporateActions?: readonly CorporateAction[];
}): CorporateActionRepository & {
  loadIdentityGraph: () => Promise<IdentityGraph>;
  failNextApply: () => void;
} {
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
    identifierAssignments: [...graph.identifierAssignments],
    relationships: [...(initial?.relationships ?? [])],
    corporateActions: [...(initial?.corporateActions ?? [])],
  };
  let failApply = false;

  const isOpen = (version: {
    validTo: string | null;
    supersededAt: string | null;
  }) => version.validTo === null && version.supersededAt === null;

  return {
    storage: "in-memory-fixture",
    async loadIdentityGraph() {
      return {
        ...graph,
        legalEntities: state.legalEntities.filter(isOpen),
        securities: graph.securities.filter(isOpen),
        listings: graph.listings.filter(isOpen),
        listingSymbols: graph.listingSymbols.filter(isOpen),
        identifierAssignments: state.identifierAssignments.filter(isOpen),
      };
    },
    failNextApply() {
      failApply = true;
    },
    async listRelationships(query) {
      const { limit } = corporateActionListQuerySchema.parse(query ?? {});

      if (state.relationships.length > limit) {
        throw new CorporateActionListLimitError("relationship", limit);
      }

      return [...state.relationships];
    },
    async listCorporateActions(query) {
      const { limit } = corporateActionListQuerySchema.parse(query ?? {});

      if (state.corporateActions.length > limit) {
        throw new CorporateActionListLimitError("corporate action", limit);
      }

      return [...state.corporateActions];
    },
    async applySuccessionPlan(plan) {
      if (failApply) {
        failApply = false;
        // Simula una transacción que no llega a commit: nada queda escrito.
        throw new Error("simulated transaction failure");
      }

      state.legalEntities.push(...plan.legalEntities);
      state.identifierAssignments.push(...plan.identifierAssignments);
      state.corporateActions.push(...plan.corporateActions);
      state.relationships.push(...plan.relationships);

      return summarizeSuccessionPlan(plan);
    },
  };
}
