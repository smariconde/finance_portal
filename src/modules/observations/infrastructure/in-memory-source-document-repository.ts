import {
  classifySourceDocuments,
  sourceDocumentLookupSchema,
  type SourceDocumentRepository,
} from "../application/source-document-repository";
import {
  sourceDocumentSchema,
  type SourceDocument,
} from "../domain/source-document";

/**
 * Doble de test del repositorio de documentos. Aplica la misma clasificación que
 * PostgreSQL —insertar lo ausente, no reescribir lo existente— para que un test
 * en memoria no pruebe una semántica distinta de la persistida.
 */
export function createInMemorySourceDocumentRepository(
  seed: readonly SourceDocument[] = [],
): SourceDocumentRepository {
  const stored = new Map<string, SourceDocument>(
    seed.map((document) => {
      const parsed = sourceDocumentSchema.parse(document);
      return [`${parsed.sourceId}|${parsed.sourceDocumentId}`, parsed];
    }),
  );

  return {
    storage: "in-memory-fixture",
    async record(documents) {
      const parsed = documents.map((document) =>
        sourceDocumentSchema.parse(document),
      );
      const existing = parsed
        .map((document) =>
          stored.get(`${document.sourceId}|${document.sourceDocumentId}`),
        )
        .filter(
          (document): document is SourceDocument => document !== undefined,
        );
      const { toInsert, unchanged, conflicts } = classifySourceDocuments(
        parsed,
        existing,
      );

      for (const document of toInsert) {
        stored.set(
          `${document.sourceId}|${document.sourceDocumentId}`,
          document,
        );
      }

      return {
        inserted: toInsert.map((document) => document.sourceDocumentId),
        unchanged,
        conflicts,
      };
    },
    async findByIds(lookup) {
      const parsed = sourceDocumentLookupSchema.parse(lookup);

      return parsed.sourceDocumentIds
        .map((id) => stored.get(`${parsed.sourceId}|${id}`))
        .filter(
          (document): document is SourceDocument => document !== undefined,
        );
    },
  };
}
