import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

import {
  CorporateActionListLimitError,
  corporateActionListQuerySchema,
  matchesCorporateActionQuery,
  StaleListingPlanError,
  summarizeListingPlan,
  summarizeDeclaredEventPlan,
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
 * entidad del antecesor y su CIK en la misma transacción que el vínculo, y un
 * evento de listing cierra y abre listings; el test lee ese grafo con
 * `loadIdentityGraph` igual que el job lee el persistido, y con `snapshotGraph`
 * ve también las versiones cerradas.
 */
export function createInMemoryCorporateActionRepository(initial?: {
  readonly graph?: Partial<IdentityGraph>;
  readonly relationships?: readonly LegalEntityRelationship[];
  readonly corporateActions?: readonly CorporateAction[];
}): CorporateActionRepository & {
  loadIdentityGraph: () => Promise<IdentityGraph>;
  snapshotGraph: () => IdentityGraph;
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
    listings: [...graph.listings],
    listingSymbols: [...graph.listingSymbols],
    identifierAssignments: [...graph.identifierAssignments],
    relationships: [...(initial?.relationships ?? [])],
    corporateActions: [...(initial?.corporateActions ?? [])],
  };
  let failApply = false;

  const isOpen = (version: {
    validTo: string | null;
    supersededAt: string | null;
  }) => version.validTo === null && version.supersededAt === null;

  const snapshotGraph = (): IdentityGraph => ({
    ...graph,
    legalEntities: [...state.legalEntities],
    listings: [...state.listings],
    listingSymbols: [...state.listingSymbols],
    identifierAssignments: [...state.identifierAssignments],
  });

  // Espeja `corporate_actions_source_document_uidx`: el doble no puede aceptar
  // lo que PostgreSQL rechazaría.
  const assertUniqueActions = (actions: readonly CorporateAction[]) => {
    for (const action of actions) {
      if (
        state.corporateActions.some(
          (existing) =>
            existing.sourceId === action.sourceId &&
            existing.sourceDocumentId === action.sourceDocumentId &&
            existing.actionType === action.actionType,
        )
      ) {
        throw new Error("duplicate key value violates unique constraint");
      }
    }
  };

  return {
    storage: "in-memory-fixture",
    async loadIdentityGraph() {
      return {
        ...graph,
        legalEntities: state.legalEntities.filter(isOpen),
        securities: graph.securities.filter(isOpen),
        listings: state.listings.filter(isOpen),
        listingSymbols: state.listingSymbols.filter(isOpen),
        identifierAssignments: state.identifierAssignments.filter(isOpen),
      };
    },
    snapshotGraph,
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
      const parsed = corporateActionListQuerySchema.parse(query ?? {});
      const matching = state.corporateActions.filter((action) =>
        matchesCorporateActionQuery(action, parsed),
      );

      if (matching.length > parsed.limit) {
        throw new CorporateActionListLimitError(
          "corporate action",
          parsed.limit,
        );
      }

      return matching;
    },
    async applyDeclaredEventPlan(plan) {
      if (failApply) {
        failApply = false;
        throw new Error("simulated transaction failure");
      }
      if (plan.status !== "planned")
        return {
          corporateActions: 0,
          relationships: 0,
          supersessions: 0,
          listingSymbols: 0,
        };
      const symbols = [...state.listingSymbols];
      for (const replacement of plan.supersessions) {
        const index = symbols.findIndex(
          (s) =>
            s.listingSymbolId === replacement.listingSymbolId &&
            s.validFrom === replacement.validFrom &&
            isOpen(s),
        );
        if (index < 0)
          throw new StaleListingPlanError(
            "listing_symbol",
            replacement.listingSymbolId,
          );
        symbols[index] = {
          ...symbols[index]!,
          supersededAt: replacement.supersededAt,
        };
      }
      assertUniqueActions(plan.corporateActions);
      for (const r of plan.relationships) {
        if (
          state.relationships.some(
            (old) =>
              isOpen(old) &&
              old.relationshipType === r.relationshipType &&
              old.predecessorLegalEntityId === r.predecessorLegalEntityId,
          )
        )
          throw new Error("duplicate key value violates unique constraint");
      }
      state.listingSymbols = [...symbols, ...plan.listingSymbols];
      state.corporateActions.push(...plan.corporateActions);
      state.relationships.push(...plan.relationships);
      return summarizeDeclaredEventPlan(plan);
    },
    async applySplitPlan(plan) {
      if (failApply) {
        failApply = false;
        throw new Error("simulated transaction failure");
      }

      if (plan.status !== "planned") {
        return { corporateActions: 0 };
      }

      assertUniqueActions(plan.corporateActions);
      state.corporateActions.push(...plan.corporateActions);

      return { corporateActions: plan.corporateActions.length };
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
    async applyListingPlan(plan) {
      if (failApply) {
        failApply = false;
        throw new Error("simulated transaction failure");
      }

      if (plan.status !== "planned") {
        return summarizeListingPlan({
          ...plan,
          closures: [],
          supersessions: [],
          legalEntities: [],
          listings: [],
          listingSymbols: [],
          corporateActions: [],
        });
      }

      // Todo se decide sobre copias y se publica al final: una versión que ya no
      // está abierta deshace el plan entero, como la transacción real.
      const legalEntities = [...state.legalEntities];
      const listings = [...state.listings];
      const listingSymbols = [...state.listingSymbols];

      const replaceOpen = <
        TVersion extends { validFrom: string } & Parameters<typeof isOpen>[0],
      >(
        versions: TVersion[],
        matches: (version: TVersion) => boolean,
        change: Partial<TVersion>,
        level: string,
        subjectId: string,
      ) => {
        const index = versions.findIndex(
          (version) => matches(version) && isOpen(version),
        );

        if (index < 0) {
          throw new StaleListingPlanError(level, subjectId);
        }

        versions[index] = { ...versions[index]!, ...change };
      };

      for (const closure of plan.closures) {
        const at = { validTo: closure.validTo };

        if (closure.level === "legal_entity") {
          replaceOpen(
            legalEntities,
            (version) =>
              version.legalEntityId === closure.subjectId &&
              version.validFrom === closure.validFrom,
            at,
            closure.level,
            closure.subjectId,
          );
        } else if (closure.level === "listing") {
          replaceOpen(
            listings,
            (version) =>
              version.listingId === closure.subjectId &&
              version.validFrom === closure.validFrom,
            at,
            closure.level,
            closure.subjectId,
          );
        } else {
          replaceOpen(
            listingSymbols,
            (version) =>
              version.listingSymbolId === closure.subjectId &&
              version.validFrom === closure.validFrom,
            at,
            closure.level,
            closure.subjectId,
          );
        }
      }

      for (const supersession of plan.supersessions) {
        replaceOpen(
          legalEntities,
          (version) =>
            version.legalEntityId === supersession.subjectId &&
            version.validFrom === supersession.validFrom,
          { supersededAt: supersession.supersededAt },
          supersession.level,
          supersession.subjectId,
        );
      }

      assertUniqueActions(plan.corporateActions);

      state.legalEntities = [...legalEntities, ...plan.legalEntities];
      state.listings = [...listings, ...plan.listings];
      state.listingSymbols = [...listingSymbols, ...plan.listingSymbols];
      state.corporateActions.push(...plan.corporateActions);

      return summarizeListingPlan(plan);
    },
  };
}
