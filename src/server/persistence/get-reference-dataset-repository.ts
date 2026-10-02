import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectReferenceDatasetRepository,
  type ReferenceDatasetRepository,
} from "@/modules/reference-data/application/reference-dataset-repository";
import { createPostgresReferenceDatasetRepository } from "@/server/db/postgres-reference-dataset-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ReferenceDatasetRepository | undefined;

export function getReferenceDatasetRepository(): ReferenceDatasetRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectReferenceDatasetRepository(effectiveMode, {
    personal: () =>
      createPostgresReferenceDatasetRepository(getRuntimeDatabase()),
  });

  return repository;
}
