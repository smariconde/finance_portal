import "server-only";

import { asc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  CorporateActionListLimitError,
  corporateActionListQuerySchema,
  summarizeSuccessionPlan,
  type CorporateActionRepository,
} from "@/modules/corporate-actions/application/corporate-action-repository";
import type { SuccessionRecordingPlan } from "@/modules/corporate-actions/domain/plan-succession-recording";
import {
  corporateActionSchema,
  legalEntityRelationshipSchema,
} from "@/modules/corporate-actions/domain/reporting-succession";
import {
  identifierAssignmentSchema,
  legalEntitySchema,
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
 * Nada se actualiza: todo lo que escribe es una versión nueva. Un plan que ya se
 * aplicó vuelve como `unchanged` desde el dominio y no llega acá.
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
      const { limit } = corporateActionListQuerySchema.parse(query ?? {});
      const rows = await database
        .select()
        .from(schema.corporateActions)
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
          await transaction.insert(schema.corporateActions).values(
            actions.map((action) => ({
              corporateActionId: action.corporateActionId,
              actionType: action.actionType,
              subjectType: action.subjectType,
              subjectId: action.subjectId,
              announcedAt:
                action.announcedAt === null
                  ? null
                  : new Date(action.announcedAt),
              effectiveOn: action.effectiveOn,
              availableAt: new Date(action.availableAt),
              sourceId: action.sourceId,
              sourceDocumentId: action.sourceDocumentId,
              terms: action.terms,
              contentHash: action.contentHash,
              recordedAt: new Date(action.recordedAt),
            })),
          );
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
  };
}
