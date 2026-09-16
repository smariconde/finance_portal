import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";

import type { SourceDocument } from "../domain/source-document";

export const sourceDocumentLookupSchema = z.object({
  sourceId: sourceIdSchema,
  sourceDocumentIds: z.array(z.string().trim().min(1).max(256)).max(5000),
});

export type SourceDocumentLookup = z.input<typeof sourceDocumentLookupSchema>;

/**
 * Resultado de registrar documentos. Ninguna rama sobreescribe: `conflicts`
 * nombra los documentos que otra corrida ya describió con otro contenido, y el
 * registro previo queda intacto (`TM-05`).
 */
export type SourceDocumentRecording = {
  readonly inserted: readonly string[];
  readonly unchanged: readonly string[];
  readonly conflicts: readonly string[];
};

export interface SourceDocumentRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Inserta los ausentes en una transacción; nunca reescribe un existente. */
  record(
    documents: readonly SourceDocument[],
  ): Promise<SourceDocumentRecording>;
  findByIds(lookup: SourceDocumentLookup): Promise<SourceDocument[]>;
}

type RepositoryFactories = {
  personal: () => SourceDocumentRepository;
};

export function selectSourceDocumentRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): SourceDocumentRepository {
  return selectPersonalDependency(mode, "source-document", factories.personal);
}

/**
 * Separa los documentos entrantes contra lo ya registrado. Vive acá y no en cada
 * implementación para que memoria y PostgreSQL decidan igual qué es un conflicto.
 */
export function classifySourceDocuments(
  incoming: readonly SourceDocument[],
  existing: readonly SourceDocument[],
): {
  toInsert: SourceDocument[];
  unchanged: string[];
  conflicts: string[];
} {
  const byId = new Map(
    existing.map((document) => [document.sourceDocumentId, document]),
  );
  const toInsert: SourceDocument[] = [];
  const unchanged: string[] = [];
  const conflicts: string[] = [];
  const seen = new Map<string, string>();

  for (const document of incoming) {
    const repeated = seen.get(document.sourceDocumentId);

    if (repeated !== undefined) {
      // El mismo documento dos veces en un lote: sólo es aceptable si describe
      // lo mismo.
      if (repeated !== document.contentHash) {
        conflicts.push(document.sourceDocumentId);
      }
      continue;
    }

    seen.set(document.sourceDocumentId, document.contentHash);
    const stored = byId.get(document.sourceDocumentId);

    if (stored === undefined) {
      toInsert.push(document);
    } else if (stored.contentHash === document.contentHash) {
      unchanged.push(document.sourceDocumentId);
    } else {
      conflicts.push(document.sourceDocumentId);
    }
  }

  const conflicted = new Set(conflicts);

  return {
    toInsert: toInsert.filter(
      (document) => !conflicted.has(document.sourceDocumentId),
    ),
    unchanged,
    conflicts: [...conflicted],
  };
}
