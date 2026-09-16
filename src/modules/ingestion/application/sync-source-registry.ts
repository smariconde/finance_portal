import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";

import type { SourceRegistryRepository } from "./source-registry-repository";

/**
 * Proyecta el registro de fuentes declarado en código sobre el almacenamiento
 * personal.
 *
 * El registro **se declara en código**: cada fila se valida con
 * `sourceRegistryEntrySchema` al cargar el módulo, y aprobar un derecho es un
 * cambio revisable en un diff. La tabla es una proyección de esa declaración, no
 * una segunda fuente de verdad: si las dos discreparan, la que vale es la del
 * repositorio, porque es la que pasó por revisión.
 *
 * Por eso esto es una sincronización en un solo sentido y no una migración de
 * datos. Una fila editada a mano en la base vuelve a su valor declarado en la
 * próxima corrida, que es lo correcto para un control de seguridad: un derecho no
 * debería poder concederse con un `UPDATE`.
 *
 * La comparación es por hash del contenido declarado, así que correrla dos veces
 * no escribe la segunda vez.
 */
export const SOURCE_REGISTRY_SYNC_VERSION = "source-registry-sync-1.0.0";

export type SourceRegistrySyncSummary = {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
};

/**
 * `recordedAt` es cuándo se escribió la fila, no parte de lo que declara, así que
 * queda fuera del hash: incluirlo haría que cada corrida se viera como un cambio.
 */
function declaredContentHash(entry: SourceRegistryEntry): string {
  return computeContentHash({ ...entry, recordedAt: null });
}

export async function syncDeclaredSourceRegistry(
  declared: readonly SourceRegistryEntry[],
  repository: SourceRegistryRepository,
): Promise<SourceRegistrySyncSummary> {
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const entry of declared) {
    const stored = await repository.findBySourceId(entry.sourceId);

    if (stored === null) {
      await repository.upsert(entry);
      created.push(entry.sourceId);
      continue;
    }

    if (declaredContentHash(stored) === declaredContentHash(entry)) {
      unchanged.push(entry.sourceId);
      continue;
    }

    await repository.upsert(entry);
    updated.push(entry.sourceId);
  }

  return { created, updated, unchanged };
}
