import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectSourceRegistryRepository,
  type SourceRegistryRepository,
} from "@/modules/ingestion/application/source-registry-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: SourceRegistryRepository | undefined;

export function getSourceRegistryRepository(): SourceRegistryRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectSourceRegistryRepository(effectiveMode, {
    personal: () =>
      createPostgresSourceRegistryRepository(getRuntimeDatabase()),
  });

  return repository;
}
