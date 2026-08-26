import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectDatasetSnapshotRepository,
  type DatasetSnapshotRepository,
} from "@/modules/persistence/application/dataset-snapshot-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";
import { createPostgresDatasetSnapshotRepository } from "@/server/db/postgres-dataset-snapshot-repository";

let repository: DatasetSnapshotRepository | undefined;

export function getDatasetSnapshotRepository(): DatasetSnapshotRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectDatasetSnapshotRepository(effectiveMode, {
    personal: () =>
      createPostgresDatasetSnapshotRepository(getRuntimeDatabase()),
  });

  return repository;
}
