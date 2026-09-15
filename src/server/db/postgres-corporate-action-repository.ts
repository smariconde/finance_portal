import "server-only";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  CorporateActionListLimitError,
  corporateActionListQuerySchema,
  StaleListingPlanError,
  summarizeListingPlan,
  summarizeSuccessionPlan,
  type CorporateActionRepository,
} from "@/modules/corporate-actions/application/corporate-action-repository";
import type { ListingReconciliationPlan } from "@/modules/corporate-actions/domain/plan-listing-reconciliation";
import type { SplitRecordingPlan } from "@/modules/corporate-actions/domain/plan-split-recording";
import type { SuccessionRecordingPlan } from "@/modules/corporate-actions/domain/plan-succession-recording";
import {
  corporateActionSchema,
  legalEntityRelationshipSchema,
  type CorporateAction,
} from "@/modules/corporate-actions/domain/reporting-succession";
import {
  identifierAssignmentSchema,
  legalEntitySchema,
  listingSchema,
  listingSymbolSchema,
  normalizeSymbol,
} from "@/modules/identity/domain/identity-graph";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Repositorio personal de corporate actions.
 *
 * Aplicar una sucesión escribe en una sola transacción las tablas del grafo de
 * identidad —la entidad del antecesor y su CIK— y las de este slice —el evento y
 * el vínculo—. Partirla dejaría un antecesor sin vínculo, que el linaje ignora, o
 * un vínculo cuya foreign key no tiene a quién apuntar.
 *
 * Una sucesión o un split no actualizan nada: todo lo que escriben es una versión
 * nueva. Un evento de listing (ADR 0013) sí cierra o supersede la versión vigente
 * que reemplaza, igual que la constitución del universo, y sólo si sigue abierta:
 * la cláusula `valid_to is null and superseded_at is null` es la que impide
 * reescribir una decisión ya tomada.
 */
export function createPostgresCorporateActionRepository(
  database: Database,
): CorporateActionRepository {
  return {
    storage: "personal-postgres",
    async listRelationships(query) {
      const { limit } = corporateActionListQuerySchema.parse(query ?? {});
      const rows = await database
        .select()
        .from(schema.legalEntityRelationships)
        .orderBy(
          asc(schema.legalEntityRelationships.relationshipId),
          asc(schema.legalEntityRelationships.validFrom),
        )
        .limit(limit + 1);

      if (rows.length > limit) {
        throw new CorporateActionListLimitError("relationship", limit);
      }

      return rows.map((row) =>
        legalEntityRelationshipSchema.parse({
          ...toTemporalFields(row),
          relationshipId: row.relationshipId,
          relationshipType: row.relationshipType,
          predecessorLegalEntityId: row.predecessorLegalEntityId,
          successorLegalEntityId: row.successorLegalEntityId,
          corporateActionId: row.corporateActionId,
          effectiveOn: row.effectiveOn,
          decidedBy: row.decidedBy,
          decisionRuleVersion: row.decisionRuleVersion,
        }),
      );
    },
    async listCorporateActions(query) {
      const { limit, subjectIds, sourceDocumentIds, actionTypes } =
        corporateActionListQuerySchema.parse(query ?? {});
      const scope = [
        subjectIds === undefined
          ? undefined
          : inArray(schema.corporateActions.subjectId, subjectIds),
        sourceDocumentIds === undefined
          ? undefined
          : inArray(
              schema.corporateActions.sourceDocumentId,
              sourceDocumentIds,
            ),
      ].filter((condition) => condition !== undefined);
      const rows = await database
        .select()
        .from(schema.corporateActions)
        .where(
          and(
            actionTypes === undefined
              ? undefined
              : inArray(schema.corporateActions.actionType, actionTypes),
            scope.length === 0 ? undefined : or(...scope),
          ),
        )
        .orderBy(asc(schema.corporateActions.corporateActionId))
        .limit(limit + 1);

      if (rows.length > limit) {
        throw new CorporateActionListLimitError("corporate action", limit);
      }

      return rows.map((row) =>
        corporateActionSchema.parse({
          corporateActionId: row.corporateActionId,
          actionType: row.actionType,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          announcedAt: row.announcedAt?.toISOString() ?? null,
          effectiveOn: row.effectiveOn,
          availableAt: row.availableAt.toISOString(),
          sourceId: row.sourceId,
          sourceDocumentId: row.sourceDocumentId,
          terms: row.terms,
          contentHash: row.contentHash,
          recordedAt: row.recordedAt.toISOString(),
        }),
      );
    },
    async applySuccessionPlan(plan: SuccessionRecordingPlan) {
      // El plan se vuelve a validar antes de escribir: el repositorio no confía
      // en que quien lo construyó lo haya parseado (`TM-05`).
      const legalEntities = plan.legalEntities.map((version) =>
        legalEntitySchema.parse(version),
      );
      const assignments = plan.identifierAssignments.map((version) =>
        identifierAssignmentSchema.parse(version),
      );
      const actions = plan.corporateActions.map((action) =>
        corporateActionSchema.parse(action),
      );
      const relationships = plan.relationships.map((relationship) =>
        legalEntityRelationshipSchema.parse(relationship),
      );

      if (plan.status !== "planned") {
        return summarizeSuccessionPlan({
          ...plan,
          legalEntities: [],
          identifierAssignments: [],
          corporateActions: [],
          relationships: [],
        });
      }

      await database.transaction(async (transaction) => {
        if (legalEntities.length > 0) {
          await transaction
            .insert(schema.legalEntities)
            .values(
              legalEntities.map((version) => ({
                legalEntityId: version.legalEntityId,
              })),
            )
            .onConflictDoNothing();
          await transaction.insert(schema.legalEntityVersions).values(
            legalEntities.map((version) => ({
              ...toTemporalRow(version),
              legalEntityId: version.legalEntityId,
              legalName: version.legalName,
              entityType: version.entityType,
              jurisdiction: version.jurisdiction,
              status: version.status,
            })),
          );
        }

        if (assignments.length > 0) {
          await transaction.insert(schema.identifierAssignments).values(
            assignments.map((version) => ({
              ...toTemporalRow(version),
              identifierAssignmentId: version.identifierAssignmentId,
              subjectType: version.subjectType,
              subjectId: version.subjectId,
              identifierType: version.identifierType,
              identifierValue: version.identifierValue,
              normalizedValue: version.normalizedValue,
              scope: version.scope,
              issuingAuthority: version.issuingAuthority,
              confidence: version.confidence,
            })),
          );
        }

        if (actions.length > 0) {
          await transaction
            .insert(schema.corporateActions)
            .values(actions.map(toCorporateActionRow));
        }

        if (relationships.length > 0) {
          await transaction.insert(schema.legalEntityRelationships).values(
            relationships.map((relationship) => ({
              ...toTemporalRow(relationship),
              relationshipId: relationship.relationshipId,
              relationshipType: relationship.relationshipType,
              predecessorLegalEntityId: relationship.predecessorLegalEntityId,
              successorLegalEntityId: relationship.successorLegalEntityId,
              corporateActionId: relationship.corporateActionId,
              effectiveOn: relationship.effectiveOn,
              decidedBy: relationship.decidedBy,
              decisionRuleVersion: relationship.decisionRuleVersion,
            })),
          );
        }
      });

      return summarizeSuccessionPlan(plan);
    },
    async applySplitPlan(plan: SplitRecordingPlan) {
      const actions = plan.corporateActions.map((action) =>
        corporateActionSchema.parse(action),
      );

      if (plan.status !== "planned" || actions.length === 0) {
        return { corporateActions: 0 };
      }

      await database.transaction(async (transaction) => {
        await transaction
          .insert(schema.corporateActions)
          .values(actions.map(toCorporateActionRow));
      });

      return { corporateActions: actions.length };
    },
    async applyListingPlan(plan: ListingReconciliationPlan) {
      const legalEntities = plan.legalEntities.map((version) =>
        legalEntitySchema.parse(version),
      );
      const listings = plan.listings.map((version) =>
        listingSchema.parse(version),
      );
      const listingSymbols = plan.listingSymbols.map((version) =>
        listingSymbolSchema.parse(version),
      );
      const actions = plan.corporateActions.map((action) =>
        corporateActionSchema.parse(action),
      );

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

      await database.transaction(async (transaction) => {
        // Cierres y supersesiones primero: el índice único de versión abierta
        // nunca debe ver dos vigentes para el mismo sujeto.
        for (const closure of plan.closures) {
          const validTo = new Date(closure.validTo);
          const validFrom = new Date(closure.validFrom);
          const rows =
            closure.level === "legal_entity"
              ? await transaction
                  .update(schema.legalEntityVersions)
                  .set({ validTo })
                  .where(
                    and(
                      eq(
                        schema.legalEntityVersions.legalEntityId,
                        closure.subjectId,
                      ),
                      eq(schema.legalEntityVersions.validFrom, validFrom),
                      isNull(schema.legalEntityVersions.validTo),
                      isNull(schema.legalEntityVersions.supersededAt),
                    ),
                  )
                  .returning({ id: schema.legalEntityVersions.legalEntityId })
              : closure.level === "listing"
                ? await transaction
                    .update(schema.listingVersions)
                    .set({ validTo })
                    .where(
                      and(
                        eq(schema.listingVersions.listingId, closure.subjectId),
                        eq(schema.listingVersions.validFrom, validFrom),
                        isNull(schema.listingVersions.validTo),
                        isNull(schema.listingVersions.supersededAt),
                      ),
                    )
                    .returning({ id: schema.listingVersions.listingId })
                : await transaction
                    .update(schema.listingSymbols)
                    .set({ validTo })
                    .where(
                      and(
                        eq(
                          schema.listingSymbols.listingSymbolId,
                          closure.subjectId,
                        ),
                        eq(schema.listingSymbols.validFrom, validFrom),
                        isNull(schema.listingSymbols.validTo),
                        isNull(schema.listingSymbols.supersededAt),
                      ),
                    )
                    .returning({ id: schema.listingSymbols.listingSymbolId });

          if (rows.length !== 1) {
            throw new StaleListingPlanError(closure.level, closure.subjectId);
          }
        }

        for (const supersession of plan.supersessions) {
          const rows = await transaction
            .update(schema.legalEntityVersions)
            .set({ supersededAt: new Date(supersession.supersededAt) })
            .where(
              and(
                eq(
                  schema.legalEntityVersions.legalEntityId,
                  supersession.subjectId,
                ),
                eq(
                  schema.legalEntityVersions.validFrom,
                  new Date(supersession.validFrom),
                ),
                isNull(schema.legalEntityVersions.validTo),
                isNull(schema.legalEntityVersions.supersededAt),
              ),
            )
            .returning({ id: schema.legalEntityVersions.legalEntityId });

          if (rows.length !== 1) {
            throw new StaleListingPlanError(
              supersession.level,
              supersession.subjectId,
            );
          }
        }

        if (legalEntities.length > 0) {
          await transaction.insert(schema.legalEntityVersions).values(
            legalEntities.map((version) => ({
              ...toTemporalRow(version),
              legalEntityId: version.legalEntityId,
              legalName: version.legalName,
              entityType: version.entityType,
              jurisdiction: version.jurisdiction,
              status: version.status,
            })),
          );
        }

        if (listings.length > 0) {
          await transaction
            .insert(schema.listings)
            .values(listings.map(({ listingId }) => ({ listingId })));
          await transaction.insert(schema.listingVersions).values(
            listings.map((version) => ({
              ...toTemporalRow(version),
              listingId: version.listingId,
              securityId: version.securityId,
              mic: version.mic,
              quoteCurrency: version.quoteCurrency,
              country: version.country,
              status: version.status,
              primaryListing: version.primaryListing,
            })),
          );
        }

        if (listingSymbols.length > 0) {
          await transaction.insert(schema.listingSymbols).values(
            listingSymbols.map((version) => ({
              ...toTemporalRow(version),
              listingSymbolId: version.listingSymbolId,
              listingId: version.listingId,
              symbol: version.symbol,
              normalizedSymbol: normalizeSymbol(version.symbol),
              symbolType: version.symbolType,
            })),
          );
        }

        if (actions.length > 0) {
          await transaction
            .insert(schema.corporateActions)
            .values(actions.map(toCorporateActionRow));
        }
      });

      return summarizeListingPlan(plan);
    },
  };
}

function toCorporateActionRow(action: CorporateAction) {
  return {
    corporateActionId: action.corporateActionId,
    actionType: action.actionType,
    subjectType: action.subjectType,
    subjectId: action.subjectId,
    announcedAt:
      action.announcedAt === null ? null : new Date(action.announcedAt),
    effectiveOn: action.effectiveOn,
    availableAt: new Date(action.availableAt),
    sourceId: action.sourceId,
    sourceDocumentId: action.sourceDocumentId,
    terms: action.terms,
    contentHash: action.contentHash,
    recordedAt: new Date(action.recordedAt),
  };
}
