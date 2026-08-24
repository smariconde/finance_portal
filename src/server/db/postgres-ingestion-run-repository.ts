import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  ingestionRunListQuerySchema,
  type IngestionRunRepository,
} from "@/modules/ingestion/application/ingestion-run-repository";
import {
  ingestionRunSchema,
  type IngestionRun,
} from "@/modules/ingestion/domain/ingestion-run";
import {
  datasetIdSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type IngestionRunRow = typeof schema.ingestionRuns.$inferSelect;

const PUBLISHABLE_STATUSES = ["succeeded", "partial"] as const;

function toDomainRun(row: IngestionRunRow) {
  return ingestionRunSchema.parse({
    runId: row.runId,
    sourceId: row.sourceId,
    datasetId: row.datasetId,
    parserVersion: row.parserVersion,
    idempotencyKey: row.idempotencyKey,
    requestedAsOf: row.requestedAsOf,
    cursor: row.cursor,
    nextCursor: row.nextCursor,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    counts: {
      fetched: row.fetchedCount,
      accepted: row.acceptedCount,
      rejected: row.rejectedCount,
      duplicate: row.duplicateCount,
    },
    contentHash: row.contentHash,
    failure:
      row.failureCode === null
        ? null
        : {
            code: row.failureCode,
            message: row.failureMessage,
            retryable: row.failureRetryable,
          },
    qualityFlags: row.qualityFlags,
    replayOfRunId: row.replayOfRunId,
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toRow(run: IngestionRun): typeof schema.ingestionRuns.$inferInsert {
  return {
    runId: run.runId,
    sourceId: run.sourceId,
    datasetId: run.datasetId,
    parserVersion: run.parserVersion,
    idempotencyKey: run.idempotencyKey,
    requestedAsOf: run.requestedAsOf,
    cursor: run.cursor,
    nextCursor: run.nextCursor,
    status: run.status,
    startedAt: new Date(run.startedAt),
    finishedAt: run.finishedAt === null ? null : new Date(run.finishedAt),
    fetchedCount: run.counts.fetched,
    acceptedCount: run.counts.accepted,
    rejectedCount: run.counts.rejected,
    duplicateCount: run.counts.duplicate,
    contentHash: run.contentHash,
    failureCode: run.failure?.code ?? null,
    failureMessage: run.failure?.message ?? null,
    failureRetryable: run.failure?.retryable ?? null,
    qualityFlags: [...run.qualityFlags],
    replayOfRunId: run.replayOfRunId,
    recordedAt: new Date(run.recordedAt),
  };
}

export function createPostgresIngestionRunRepository(
  database: Database,
): IngestionRunRepository {
  return {
    storage: "personal-postgres",
    async findByIdempotencyKey(idempotencyKey) {
      const parsedKey =
        ingestionRunSchema.shape.idempotencyKey.parse(idempotencyKey);
      const [row] = await database
        .select()
        .from(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.idempotencyKey, parsedKey))
        .orderBy(desc(schema.ingestionRuns.startedAt))
        .limit(1);

      return row ? toDomainRun(row) : null;
    },
    async findLatestPublishable(sourceId, datasetId) {
      const [row] = await database
        .select()
        .from(schema.ingestionRuns)
        .where(
          and(
            eq(schema.ingestionRuns.sourceId, sourceIdSchema.parse(sourceId)),
            eq(
              schema.ingestionRuns.datasetId,
              datasetIdSchema.parse(datasetId),
            ),
            inArray(schema.ingestionRuns.status, PUBLISHABLE_STATUSES),
          ),
        )
        .orderBy(desc(schema.ingestionRuns.startedAt))
        .limit(1);

      return row ? toDomainRun(row) : null;
    },
    async list(query) {
      const parsedQuery = ingestionRunListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.ingestionRuns)
        .where(
          and(
            eq(schema.ingestionRuns.sourceId, parsedQuery.sourceId),
            parsedQuery.datasetId === undefined
              ? undefined
              : eq(schema.ingestionRuns.datasetId, parsedQuery.datasetId),
          ),
        )
        .orderBy(desc(schema.ingestionRuns.startedAt))
        .limit(parsedQuery.limit);

      return rows.map(toDomainRun);
    },
    async append(run) {
      // Append-only: `onConflictDoNothing` no aplica, un conflicto de clave
      // publicable debe fallar y quedar visible.
      const [row] = await database
        .insert(schema.ingestionRuns)
        .values(toRow(ingestionRunSchema.parse(run)))
        .returning();

      return toDomainRun(row!);
    },
  };
}
