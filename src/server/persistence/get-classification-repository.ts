import "server-only";

import {
  selectClassificationRepository,
  type ClassificationRepository,
} from "@/modules/classification/application/classification-repository";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { createPostgresClassificationRepository } from "@/server/db/postgres-classification-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ClassificationRepository | undefined;

export function getClassificationRepository(): ClassificationRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectClassificationRepository(effectiveMode, {
    personal: () =>
      createPostgresClassificationRepository(getRuntimeDatabase()),
  });

  return repository;
}
