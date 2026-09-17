import "server-only";

import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  MAX_REVISION_GROUPS_PER_LOOKUP,
  observationListQuerySchema,
  observationSupersessionSchema,
  revisionGroupIdSchema,
  type ObservationPublication,
  type ObservationRepository,
} from "@/modules/observations/application/observation-repository";
import {
  LATE_INGESTION_FLAG,
  observationSchema,
  withIngestionFlags,
  type Observation,
} from "@/modules/observations/domain/observation";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ObservationRow = typeof schema.observations.$inferSelect;

/**
 * Procedencia que la fila no guarda: es la de la corrida que la publicó
 * (ADR 0018).
 */
type RunProvenance = Pick<
  typeof schema.ingestionRuns.$inferSelect,
  "sourceId" | "datasetId" | "parserVersion"
>;

/** 500 filas × 27 columnas = 13.500 parámetros, lejos del techo de PostgreSQL. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Una observación que dice venir de otra fuente, dataset o parser que su corrida.
 * La fila ya no guarda esos tres valores, así que aceptarla los cambiaría en
 * silencio por los de la corrida.
 */
export class ObservationProvenanceError extends Error {
  constructor(observationId: string, ingestionRunId: string) {
    super(
      `Observation ${observationId} does not carry the source, dataset and parser of run ${ingestionRunId}.`,
    );
    this.name = "ObservationProvenanceError";
  }
}

const observationWithProvenance = {
  ...getTableColumns(schema.observations),
  sourceId: schema.ingestionRuns.sourceId,
  datasetId: schema.ingestionRuns.datasetId,
  parserVersion: schema.ingestionRuns.parserVersion,
};

/** La métrica de una fila con `metric_id` nulo es su concepto. */
const metricOf: SQL<string> = sql`coalesce(${schema.observations.metricId}, ${schema.observations.concept})`;

function toDomainObservation(
  row: ObservationRow,
  provenance: RunProvenance,
): Observation {
  const availableAt = row.availableAt.toISOString();
  const recordedAt = row.recordedAt.toISOString();

  return observationSchema.parse({
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
    sourceId: provenance.sourceId,
    datasetId: provenance.datasetId,
    valueBasis: row.valueBasis,
    parserVersion: provenance.parserVersion,
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
    qualityFlags: withIngestionFlags(row.qualityFlags, availableAt, recordedAt),
    sourceDocumentId: row.sourceDocumentId,
    ingestionRunId: row.ingestionRunId,
  });
}

function fromJoinedRow(row: ObservationRow & RunProvenance): Observation {
  return toDomainObservation(row, row);
}

function toRow(
  observation: Observation,
): typeof schema.observations.$inferInsert {
  return {
    observationId: observation.observationId,
    subjectType: observation.subjectType,
    subjectId: observation.subjectId,
    metricId:
      observation.metricId === observation.concept
        ? null
        : observation.metricId,
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
    // El schema del dominio garantiza que `late_ingestion` va último y sólo
    // cuando la regla lo pide: sacarlo y volver a derivarlo es la identidad.
    qualityFlags: observation.qualityFlags.filter(
      (flag) => flag !== LATE_INGESTION_FLAG,
    ),
    sourceDocumentId: observation.sourceDocumentId,
    ingestionRunId: observation.ingestionRunId,
  };
}

export function createPostgresObservationRepository(
  database: Database,
): ObservationRepository {
  function selectObservations() {
    return database
      .select(observationWithProvenance)
      .from(schema.observations)
      .innerJoin(
        schema.ingestionRuns,
        eq(schema.observations.ingestionRunId, schema.ingestionRuns.runId),
      );
  }

  async function listGroup(revisionGroupId: string): Promise<Observation[]> {
    const rows = await selectObservations()
      .where(
        eq(
          schema.observations.revisionGroupId,
          revisionGroupIdSchema.parse(revisionGroupId),
        ),
      )
      .orderBy(asc(schema.observations.revisionNumber));

    return rows.map(fromJoinedRow);
  }

  return {
    storage: "personal-postgres",
    async findLatestRevision(revisionGroupId) {
      return (await listGroup(revisionGroupId)).at(-1) ?? null;
    },
    async listByRevisionGroup(revisionGroupId) {
      return listGroup(revisionGroupId);
    },
    async listRevisionGroups(revisionGroupIds) {
      if (revisionGroupIds.length === 0) {
        return [];
      }

      if (revisionGroupIds.length > MAX_REVISION_GROUPS_PER_LOOKUP) {
        throw new RangeError(
          `At most ${MAX_REVISION_GROUPS_PER_LOOKUP} revision groups per lookup.`,
        );
      }

      const rows = await selectObservations()
        .where(
          inArray(
            schema.observations.revisionGroupId,
            revisionGroupIds.map((id) => revisionGroupIdSchema.parse(id)),
          ),
        )
        .orderBy(
          asc(schema.observations.revisionGroupId),
          asc(schema.observations.revisionNumber),
        );

      return rows.map(fromJoinedRow);
    },
    async list(query) {
      const parsedQuery = observationListQuerySchema.parse(query);
      const rows = await selectObservations()
        .where(
          and(
            eq(schema.observations.subjectType, parsedQuery.subjectType),
            eq(schema.observations.subjectId, parsedQuery.subjectId),
            parsedQuery.metricIds === undefined
              ? undefined
              : inArray(metricOf, parsedQuery.metricIds),
          ),
        )
        .orderBy(
          asc(schema.observations.revisionGroupId),
          asc(schema.observations.revisionNumber),
        )
        .limit(parsedQuery.limit);

      return rows.map(fromJoinedRow);
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
        const runIds = [
          ...new Set(
            observations.map((observation) => observation.ingestionRunId),
          ),
        ];
        const runs = new Map<string, RunProvenance>(
          runIds.length === 0
            ? []
            : (
                await transaction
                  .select({
                    runId: schema.ingestionRuns.runId,
                    sourceId: schema.ingestionRuns.sourceId,
                    datasetId: schema.ingestionRuns.datasetId,
                    parserVersion: schema.ingestionRuns.parserVersion,
                  })
                  .from(schema.ingestionRuns)
                  .where(inArray(schema.ingestionRuns.runId, runIds))
              ).map(({ runId, ...provenance }) => [runId, provenance]),
        );

        for (const observation of observations) {
          const run = runs.get(observation.ingestionRunId);

          if (
            run === undefined ||
            run.sourceId !== observation.sourceId ||
            run.datasetId !== observation.datasetId ||
            run.parserVersion !== observation.parserVersion
          ) {
            throw new ObservationProvenanceError(
              observation.observationId,
              observation.ingestionRunId,
            );
          }
        }

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

        const inserted: Observation[] = [];

        // Un statement admite 65.535 parámetros y cada fila usa 27: un
        // documento de la SEC con miles de hechos no entra en un solo INSERT.
        // Los tramos siguen dentro de la misma transacción, así que la
        // publicación sigue siendo todo o nada.
        for (
          let offset = 0;
          offset < observations.length;
          offset += INSERT_CHUNK_SIZE
        ) {
          const rows = await transaction
            .insert(schema.observations)
            .values(
              observations.slice(offset, offset + INSERT_CHUNK_SIZE).map(toRow),
            )
            .returning();

          inserted.push(
            ...rows.map((row) =>
              toDomainObservation(row, runs.get(row.ingestionRunId)!),
            ),
          );
        }

        return inserted;
      });
    },
  };
}
