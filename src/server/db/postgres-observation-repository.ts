import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  observationListQuerySchema,
  observationSupersessionSchema,
  revisionGroupIdSchema,
  type ObservationPublication,
  type ObservationRepository,
} from "@/modules/observations/application/observation-repository";
import {
  observationSchema,
  type Observation,
} from "@/modules/observations/domain/observation";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ObservationRow = typeof schema.observations.$inferSelect;

function toDomainObservation(row: ObservationRow): Observation {
  return observationSchema.parse({
    observationId: row.observationId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    metricId: row.metricId,
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
    availableAt: row.availableAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    revisionGroupId: row.revisionGroupId,
    revisionNumber: row.revisionNumber,
    restatementOfId: row.restatementOfId,
    contentHash: row.contentHash,
    qualityFlags: row.qualityFlags,
    sourceDocumentId: row.sourceDocumentId,
    externalId: row.externalId,
    ingestionRunId: row.ingestionRunId,
  });
}

function toRow(
  observation: Observation,
): typeof schema.observations.$inferInsert {
  return {
    observationId: observation.observationId,
    subjectType: observation.subjectType,
    subjectId: observation.subjectId,
    metricId: observation.metricId,
    concept: observation.concept,
    asOf: observation.asOf,
    periodStart: observation.periodStart,
    periodEnd: observation.periodEnd,
    periodType: observation.periodType,
    unit: observation.unit,
    currency: observation.currency,
    rawValue: observation.rawValue,
    rawValueStatus: observation.rawValueStatus,
    normalizedValue: observation.normalizedValue,
    transformationId: observation.transformationId,
    valueBasis: observation.valueBasis,
    availableAt: new Date(observation.availableAt),
    supersededAt:
      observation.supersededAt === null
        ? null
        : new Date(observation.supersededAt),
    fetchedAt: new Date(observation.fetchedAt),
    recordedAt: new Date(observation.recordedAt),
    revisionGroupId: observation.revisionGroupId,
    revisionNumber: observation.revisionNumber,
    restatementOfId: observation.restatementOfId,
    contentHash: observation.contentHash,
    qualityFlags: [...observation.qualityFlags],
    sourceId: observation.sourceId,
    datasetId: observation.datasetId,
    parserVersion: observation.parserVersion,
    sourceDocumentId: observation.sourceDocumentId,
    externalId: observation.externalId,
    ingestionRunId: observation.ingestionRunId,
  };
}

export function createPostgresObservationRepository(
  database: Database,
): ObservationRepository {
  async function listGroup(revisionGroupId: string): Promise<Observation[]> {
    const rows = await database
      .select()
      .from(schema.observations)
      .where(
        eq(
          schema.observations.revisionGroupId,
          revisionGroupIdSchema.parse(revisionGroupId),
        ),
      )
      .orderBy(asc(schema.observations.revisionNumber));

    return rows.map(toDomainObservation);
  }

  return {
    storage: "personal-postgres",
    async findLatestRevision(revisionGroupId) {
      return (await listGroup(revisionGroupId)).at(-1) ?? null;
    },
    async listByRevisionGroup(revisionGroupId) {
      return listGroup(revisionGroupId);
    },
    async list(query) {
      const parsedQuery = observationListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.observations)
        .where(
          and(
            eq(schema.observations.subjectType, parsedQuery.subjectType),
            eq(schema.observations.subjectId, parsedQuery.subjectId),
            parsedQuery.metricIds === undefined
              ? undefined
              : inArray(schema.observations.metricId, parsedQuery.metricIds),
          ),
        )
        .orderBy(
          asc(schema.observations.revisionGroupId),
          asc(schema.observations.revisionNumber),
        )
        .limit(parsedQuery.limit);

      return rows.map(toDomainObservation);
    },
    async publish(publication: ObservationPublication) {
      const observations = publication.observations.map((observation) =>
        observationSchema.parse(observation),
      );
      const supersessions = publication.supersessions.map((supersession) =>
        observationSupersessionSchema.parse(supersession),
      );

      // Transacción única: cerrar la revisión anterior e insertar la nueva es
      // una sola operación. Las supersesiones van primero para que el índice
      // único de revisión vigente nunca vea dos filas abiertas.
      return database.transaction(async (transaction) => {
        for (const supersession of supersessions) {
          await transaction
            .update(schema.observations)
            .set({ supersededAt: new Date(supersession.supersededAt) })
            .where(
              and(
                eq(
                  schema.observations.observationId,
                  supersession.observationId,
                ),
                // Una supersesión sólo cierra una cadena abierta: nunca
                // reescribe una decisión ya tomada.
                isNull(schema.observations.supersededAt),
              ),
            );
        }

        if (observations.length === 0) {
          return [];
        }

        const rows = await transaction
          .insert(schema.observations)
          .values(observations.map(toRow))
          .returning();

        return rows.map(toDomainObservation);
      });
    },
  };
}
