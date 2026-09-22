import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  classificationQuerySchema,
  type ClassificationRepository,
  type SectorClassificationSummary,
} from "@/modules/classification/application/classification-repository";
import type { SectorClassificationPlan } from "@/modules/classification/domain/plan-sector-classification";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Repositorio personal de clasificaciones declaradas (ADR 0025).
 *
 * Escribe el plan en una sola transacción porque superseder la aserción vieja y
 * abrir la nueva es **una** operación: partida, el índice único parcial
 * rechazaría la segunda mitad y el sujeto quedaría sin sector vigente o con dos.
 */
export function createPostgresClassificationRepository(
  database: Database,
): ClassificationRepository {
  return {
    storage: "personal-postgres",
    async loadClassifications(query) {
      const parsed = classificationQuerySchema.parse(query);

      const rows = await database
        .select()
        .from(schema.classificationAssignments)
        .where(
          eq(schema.classificationAssignments.taxonomyId, parsed.taxonomyId),
        )
        // Un registro más que el techo alcanza para distinguir "entró justo" de
        // "se pasó", sin traer la tabla entera para contarla.
        .limit(parsed.limit + 1);

      if (rows.length > parsed.limit) {
        throw new Error(
          `classification read exceeded its limit of ${parsed.limit} rows for ${parsed.taxonomyId}`,
        );
      }

      return rows.map((row) =>
        subjectClassificationSchema.parse({
          classificationAssignmentId: row.classificationAssignmentId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          taxonomyId: row.taxonomyId,
          taxonomyVersion: row.taxonomyVersion,
          code: row.code,
          label: row.label,
          ...toTemporalFields(row),
        }),
      );
    },
    async applySectorPlan(
      plan: SectorClassificationPlan,
    ): Promise<SectorClassificationSummary> {
      await database.transaction(async (tx) => {
        for (const supersession of plan.supersessions) {
          const updated = await tx
            .update(schema.classificationAssignments)
            .set({ supersededAt: new Date(supersession.supersededAt) })
            .where(
              and(
                eq(
                  schema.classificationAssignments.subjectId,
                  supersession.subjectId,
                ),
                eq(
                  schema.classificationAssignments.taxonomyId,
                  plan.taxonomyId,
                ),
                eq(
                  schema.classificationAssignments.validFrom,
                  new Date(supersession.validFrom),
                ),
                isNull(schema.classificationAssignments.validTo),
                isNull(schema.classificationAssignments.supersededAt),
              ),
            )
            .returning({
              subjectId: schema.classificationAssignments.subjectId,
            });

          // Cero filas significa que la aserción que el plan vio ya no está
          // abierta: otra corrida la movió entre el plan y la escritura. Se
          // aborta en vez de abrir la nueva, que dejaría dos vigentes.
          if (updated.length !== 1) {
            throw new Error(
              `expected exactly one open classification to supersede for subject ${supersession.subjectId}, updated ${updated.length}`,
            );
          }
        }

        if (plan.opened.length > 0) {
          await tx.insert(schema.classificationAssignments).values(
            plan.opened.map((classification) => ({
              classificationAssignmentId:
                classification.classificationAssignmentId,
              subjectType: classification.subjectType,
              subjectId: classification.subjectId,
              taxonomyId: classification.taxonomyId,
              taxonomyVersion: classification.taxonomyVersion,
              code: classification.code,
              label: classification.label,
              ...toTemporalRow(classification),
            })),
          );
        }
      });

      return {
        ruleVersion: plan.ruleVersion,
        taxonomyId: plan.taxonomyId,
        taxonomyVersion: plan.taxonomyVersion,
        applied: {
          opened: plan.opened.length,
          superseded: plan.supersessions.length,
        },
        unchanged: plan.counts.unchanged,
        rejected: plan.counts.rejected,
        notReasserted: plan.counts.notReasserted,
      };
    },
  };
}
