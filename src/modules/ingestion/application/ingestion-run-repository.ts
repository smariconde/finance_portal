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
  /** Corrida más reciente registrada para esa clave, publicable o no. */
  findByIdempotencyKey(idempotencyKey: string): Promise<IngestionRun | null>;
  /** Última corrida publicable, usada para deduplicar por content hash. */
  findLatestPublishable(
    sourceId: string,
    datasetId: string,
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
