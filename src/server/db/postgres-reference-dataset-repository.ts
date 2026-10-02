import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  MAX_RELEASES_PER_DATASET,
  type OpenedReleasePlan,
  type ReferenceDatasetRepository,
} from "@/modules/reference-data/application/reference-dataset-repository";
import {
  referenceReleaseSchema,
  referenceRowSchema,
} from "@/modules/reference-data/domain/reference-release";

import * as schema from "./schema";
import { toTemporalFields, toTemporalRow } from "./temporal-row";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Repositorio personal de datasets de referencia (`F3-04`, ADR 0032).
 *
 * Supersede la release vigente y abre la nueva con sus filas en una sola
 * transacción; si la vigente ya no es la que el plan vio, aborta en vez de abrir
 * una segunda.
 */
export function createPostgresReferenceDatasetRepository(
  database: Database,
): ReferenceDatasetRepository {
  return {
    storage: "personal-postgres",
    async listReleases(datasetId) {
      const rows = await database
        .select()
        .from(schema.referenceDatasetReleases)
        .where(eq(schema.referenceDatasetReleases.datasetId, datasetId))
        .orderBy(asc(schema.referenceDatasetReleases.validFrom))
        .limit(MAX_RELEASES_PER_DATASET + 1);

      if (rows.length > MAX_RELEASES_PER_DATASET) {
        throw new Error(
          `reference dataset ${datasetId} exceeded ${MAX_RELEASES_PER_DATASET} releases`,
        );
      }

      return rows.map((row) =>
        referenceReleaseSchema.parse({
          releaseId: row.releaseId,
          datasetId: row.datasetId,
          publishedLabel: row.publishedLabel,
          parserVersion: row.parserVersion,
          rowCount: row.rowCount,
          ingestionRunId: row.ingestionRunId,
          ...toTemporalFields(row),
        }),
      );
    },
    async loadRows(releaseId) {
      const rows = await database
        .select()
        .from(schema.referenceDatasetRows)
        .where(eq(schema.referenceDatasetRows.releaseId, releaseId))
        .orderBy(asc(schema.referenceDatasetRows.rowKey));

      return rows.map((row) =>
        referenceRowSchema.parse({
          key: row.rowKey,
          label: row.label,
          values: row.values,
        }),
      );
    },
    async applyReleasePlan(plan: OpenedReleasePlan) {
      await database.transaction(async (tx) => {
        if (plan.supersedes !== null) {
          const updated = await tx
            .update(schema.referenceDatasetReleases)
            .set({ supersededAt: new Date(plan.release.availableAt) })
            .where(
              and(
                eq(
                  schema.referenceDatasetReleases.releaseId,
                  plan.supersedes.releaseId,
                ),
                isNull(schema.referenceDatasetReleases.validTo),
                isNull(schema.referenceDatasetReleases.supersededAt),
              ),
            )
            .returning({
              releaseId: schema.referenceDatasetReleases.releaseId,
            });

          if (updated.length !== 1) {
            throw new Error(
              `expected the open release of ${plan.release.datasetId} to supersede, updated ${updated.length}`,
            );
          }
        }

        await tx.insert(schema.referenceDatasetReleases).values({
          releaseId: plan.release.releaseId,
          datasetId: plan.release.datasetId,
          publishedLabel: plan.release.publishedLabel,
          parserVersion: plan.release.parserVersion,
          rowCount: plan.release.rowCount,
          ingestionRunId: plan.release.ingestionRunId,
          ...toTemporalRow(plan.release),
        });

        await tx.insert(schema.referenceDatasetRows).values(
          plan.rows.map((row) => ({
            releaseId: plan.release.releaseId,
            rowKey: row.key,
            label: row.label,
            values: row.values,
          })),
        );
      });
    },
  };
}
