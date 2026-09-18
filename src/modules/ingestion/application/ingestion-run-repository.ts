import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { IngestionRun } from "@/modules/ingestion/domain/ingestion-run";
import {
  datasetIdSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";

export const ingestionRunListQuerySchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type IngestionRunListQuery = z.input<typeof ingestionRunListQuerySchema>;

export interface IngestionRunRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /**
   * La corrida publicable de esa clave —a lo sumo una, por el índice único— y,
   * si no hay ninguna, la más reciente.
   *
   * La publicable va primero aunque no sea la última: una clave también la llevan
   * las corridas `duplicate` que registran cada vuelta a mirar el mismo
   * contenido. Devolver la más reciente hacía que la tercera ingesta de un
   * contenido sin cambios no viera la original e intentara publicarla otra vez
   * (medido el 2026-09-16 con Apple en el backfill, ADR 0015).
   */
  findByIdempotencyKey(idempotencyKey: string): Promise<IngestionRun | null>;
  /** Última corrida publicable, usada para deduplicar por content hash. */
  findLatestPublishable(
    sourceId: string,
    datasetId: string,
  ): Promise<IngestionRun | null>;
  /**
   * Última corrida de ese sujeto que registró un ancla de selección. Es lo que
   * dice hasta dónde fue a buscar la ingesta más reciente, y por eso lo único
   * que puede definir el corte de una poda (ADR 0019). Una corrida sin ancla no
   * llegó a leer los hechos y no describe ninguna ventana.
   */
  findLatestAnchored(
    sourceId: string,
    datasetId: string,
    subjectKey: string,
  ): Promise<IngestionRun | null>;
  list(query: IngestionRunListQuery): Promise<IngestionRun[]>;
  /** Append-only: una corrida ya registrada no se reescribe. */
  append(run: IngestionRun): Promise<IngestionRun>;
}

type RepositoryFactories = {
  personal: () => IngestionRunRepository;
};

export function selectIngestionRunRepository(
  mode: AppMode,
  factories: RepositoryFactories,
): IngestionRunRepository {
  return selectPersonalDependency(mode, "ingestion-run", factories.personal);
}

export function createIngestionRunCacheIdentity(
  mode: AppMode,
  sourceId: string,
  datasetId: string,
): readonly ["ingestion-run", AppMode, string, string] {
  return [
    "ingestion-run",
    mode,
    sourceIdSchema.parse(sourceId),
    datasetIdSchema.parse(datasetId),
  ];
}
