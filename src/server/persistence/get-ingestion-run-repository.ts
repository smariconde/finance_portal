import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectIngestionRunRepository,
  type IngestionRunRepository,
} from "@/modules/ingestion/application/ingestion-run-repository";
import { createDemoIngestionRunRepository } from "@/modules/ingestion/infrastructure/demo-ingestion-run-repository";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: IngestionRunRepository | undefined;

export function getIngestionRunRepository(): IngestionRunRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectIngestionRunRepository(effectiveMode, {
    // La demo no abre PostgreSQL: sus corridas viven en el proceso.
    demo: createDemoIngestionRunRepository,
    personal: () => createPostgresIngestionRunRepository(getRuntimeDatabase()),
  });

  return repository;
}
