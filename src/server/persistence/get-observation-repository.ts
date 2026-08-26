import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectObservationRepository,
  type ObservationRepository,
} from "@/modules/observations/application/observation-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ObservationRepository | undefined;

export function getObservationRepository(): ObservationRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectObservationRepository(effectiveMode, {
    personal: () => createPostgresObservationRepository(getRuntimeDatabase()),
  });

  return repository;
}
