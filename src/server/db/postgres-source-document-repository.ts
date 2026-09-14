import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  classifySourceDocuments,
  sourceDocumentLookupSchema,
  type SourceDocumentRepository,
} from "@/modules/observations/application/source-document-repository";
import {
  sourceDocumentSchema,
  type SourceDocument,
} from "@/modules/observations/domain/source-document";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type SourceDocumentRow = typeof schema.sourceDocuments.$inferSelect;

const LOOKUP_CHUNK_SIZE = 1000;

function toDomainDocument(row: SourceDocumentRow): SourceDocument {
  return sourceDocumentSchema.parse({
    sourceId: row.sourceId,
    sourceDocumentId: row.sourceDocumentId,
    documentType: row.documentType,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    publishedOn: row.publishedOn,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    availableAt: row.availableAt.toISOString(),
    availabilityRule: row.availabilityRule,
    periodEndOn: row.periodEndOn,
    fiscalYear: row.fiscalYear,
    fiscalPeriod: row.fiscalPeriod,
    contentHash: row.contentHash,
    ingestionRunId: row.ingestionRunId,
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toRow(
  document: SourceDocument,
): typeof schema.sourceDocuments.$inferInsert {
  return {
    sourceId: document.sourceId,
    sourceDocumentId: document.sourceDocumentId,
    documentType: document.documentType,
    subjectType: document.subjectType,
    subjectId: document.subjectId,
    publishedOn: document.publishedOn,
    acceptedAt:
      document.acceptedAt === null ? null : new Date(document.acceptedAt),
    availableAt: new Date(document.availableAt),
    availabilityRule: document.availabilityRule,
    periodEndOn: document.periodEndOn,
    fiscalYear: document.fiscalYear,
    fiscalPeriod: document.fiscalPeriod,
    contentHash: document.contentHash,
    ingestionRunId: document.ingestionRunId,
    recordedAt: new Date(document.recordedAt),
  };
}

export function createPostgresSourceDocumentRepository(
  database: Database,
): SourceDocumentRepository {
  type Reader = Pick<Database, "select">;

  async function findExisting(
    reader: Reader,
    documents: readonly SourceDocument[],
  ): Promise<SourceDocument[]> {
    const bySource = new Map<string, string[]>();

    for (const document of documents) {
      const ids = bySource.get(document.sourceId);
      if (ids === undefined) {
        bySource.set(document.sourceId, [document.sourceDocumentId]);
      } else {
        ids.push(document.sourceDocumentId);
      }
    }

    const existing: SourceDocument[] = [];

    for (const [sourceId, ids] of bySource) {
      for (let offset = 0; offset < ids.length; offset += LOOKUP_CHUNK_SIZE) {
        const rows = await reader
          .select()
          .from(schema.sourceDocuments)
          .where(
            and(
              eq(schema.sourceDocuments.sourceId, sourceId),
              inArray(
                schema.sourceDocuments.sourceDocumentId,
                ids.slice(offset, offset + LOOKUP_CHUNK_SIZE),
              ),
            ),
          );

        existing.push(...rows.map(toDomainDocument));
      }
    }

    return existing;
  }

  return {
    storage: "personal-postgres",
    async record(documents) {
      const parsed = documents.map((document) =>
        sourceDocumentSchema.parse(document),
      );

      if (parsed.length === 0) {
        return { inserted: [], unchanged: [], conflicts: [] };
      }

      return database.transaction(async (transaction) => {
        const { toInsert, unchanged, conflicts } = classifySourceDocuments(
          parsed,
          await findExisting(transaction, parsed),
        );

        for (
          let offset = 0;
          offset < toInsert.length;
          offset += LOOKUP_CHUNK_SIZE
        ) {
          // Sin `onConflictDoUpdate`: un documento registrado no se reescribe.
          // Si otra corrida lo insertó entre la lectura y este INSERT, la clave
          // primaria corta la transacción en vez de pisarlo.
          await transaction
            .insert(schema.sourceDocuments)
            .values(
              toInsert.slice(offset, offset + LOOKUP_CHUNK_SIZE).map(toRow),
            );
        }

        return {
          inserted: toInsert.map((document) => document.sourceDocumentId),
          unchanged,
          conflicts,
        };
      });
    },
    async findByIds(lookup) {
      const parsed = sourceDocumentLookupSchema.parse(lookup);

      if (parsed.sourceDocumentIds.length === 0) {
        return [];
      }

      const rows = await database
        .select()
        .from(schema.sourceDocuments)
        .where(
          and(
            eq(schema.sourceDocuments.sourceId, parsed.sourceId),
            inArray(
              schema.sourceDocuments.sourceDocumentId,
              parsed.sourceDocumentIds,
            ),
          ),
        );
      const byId = new Map(
        rows.map((row) => [row.sourceDocumentId, toDomainDocument(row)]),
      );

      return parsed.sourceDocumentIds
        .map((id) => byId.get(id))
        .filter(
          (document): document is SourceDocument => document !== undefined,
        );
    },
  };
}
