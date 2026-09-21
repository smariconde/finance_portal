import "server-only";

import { asc, eq, getTableColumns, gt, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  auditPageQuerySchema,
  type AuditChainPage,
  type PointInTimeAuditReader,
} from "@/modules/observations/application/point-in-time-audit-reader";
import {
  observationSchema,
  withIngestionFlags,
  type Observation,
} from "@/modules/observations/domain/observation";
import { sourceDocumentKey } from "@/modules/observations/domain/point-in-time-audit";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Lectura paginada de cadenas completas para el verificador del gate.
 *
 * Tres consultas acotadas por página: las próximas cadenas, sus filas con la
 * procedencia de la corrida, y los documentos que esas filas citan. Ninguna
 * recorre la tabla entera, y una cadena nunca se parte entre dos páginas:
 * auditarla a medias inventaría cortes de revisión que no existen.
 */
export function createPostgresPointInTimeAuditReader(
  database: Database,
): PointInTimeAuditReader {
  return {
    storage: "personal-postgres",
    async readChainPage(query): Promise<AuditChainPage> {
      const parsed = auditPageQuerySchema.parse(query);

      const groupRows = await database
        .selectDistinct({
          revisionGroupId: schema.observations.revisionGroupId,
        })
        .from(schema.observations)
        .where(
          parsed.after === null
            ? undefined
            : gt(schema.observations.revisionGroupId, parsed.after),
        )
        .orderBy(asc(schema.observations.revisionGroupId))
        .limit(parsed.limit);

      const revisionGroupIds = groupRows.map((row) => row.revisionGroupId);

      if (revisionGroupIds.length === 0) {
        return { chains: [], documents: new Map(), cursor: null };
      }

      const rows = await database
        .select({
          ...getTableColumns(schema.observations),
          sourceId: schema.ingestionRuns.sourceId,
          datasetId: schema.ingestionRuns.datasetId,
          parserVersion: schema.ingestionRuns.parserVersion,
        })
        .from(schema.observations)
        .innerJoin(
          schema.ingestionRuns,
          eq(schema.ingestionRuns.runId, schema.observations.ingestionRunId),
        )
        .where(inArray(schema.observations.revisionGroupId, revisionGroupIds))
        .orderBy(
          asc(schema.observations.revisionGroupId),
          asc(schema.observations.revisionNumber),
        );

      const documentIds = [
        ...new Set(
          rows.flatMap((row) =>
            row.sourceDocumentId === null ? [] : [row.sourceDocumentId],
          ),
        ),
      ];

      const documentRows =
        documentIds.length === 0
          ? []
          : await database
              .select({
                sourceId: schema.sourceDocuments.sourceId,
                sourceDocumentId: schema.sourceDocuments.sourceDocumentId,
                availableAt: schema.sourceDocuments.availableAt,
              })
              .from(schema.sourceDocuments)
              .where(
                inArray(schema.sourceDocuments.sourceDocumentId, documentIds),
              );

      const chains = new Map<string, Observation[]>();

      for (const row of rows) {
        const availableAt = row.availableAt.toISOString();
        const recordedAt = row.recordedAt.toISOString();

        const observation = observationSchema.parse({
          observationId: row.observationId,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          metricId: row.metricId ?? row.concept,
          concept: row.concept,
          asOf: row.asOf,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          periodType: row.periodType,
          unit: row.unit,
          currency: row.currency,
          sourceId: row.sourceId,
          datasetId: row.datasetId,
          valueBasis: row.valueBasis,
          parserVersion: row.parserVersion,
          rawValue: row.rawValue,
          rawValueStatus: row.rawValueStatus,
          normalizedValue: row.normalizedValue,
          transformationId: row.transformationId,
          availableAt,
          supersededAt: row.supersededAt?.toISOString() ?? null,
          fetchedAt: row.fetchedAt.toISOString(),
          recordedAt,
          revisionGroupId: row.revisionGroupId,
          revisionNumber: row.revisionNumber,
          restatementOfId: row.restatementOfId,
          contentHash: row.contentHash,
          qualityFlags: withIngestionFlags(
            row.qualityFlags,
            availableAt,
            recordedAt,
          ),
          sourceDocumentId: row.sourceDocumentId,
          ingestionRunId: row.ingestionRunId,
        });

        const chain = chains.get(observation.revisionGroupId);

        if (chain) {
          chain.push(observation);
        } else {
          chains.set(observation.revisionGroupId, [observation]);
        }
      }

      return {
        chains: [...chains.values()],
        documents: new Map(
          documentRows.map((row) => [
            sourceDocumentKey(row.sourceId, row.sourceDocumentId),
            row.availableAt.toISOString(),
          ]),
        ),
        cursor: revisionGroupIds[revisionGroupIds.length - 1] ?? null,
      };
    },
  };
}
