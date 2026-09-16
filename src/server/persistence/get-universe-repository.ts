import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectUniverseRepository,
  type UniverseRepository,
} from "@/modules/universe/application/universe-repository";
import { createPostgresUniverseRepository } from "@/server/db/postgres-universe-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: UniverseRepository | undefined;

export function getUniverseRepository(): UniverseRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectUniverseRepository(effectiveMode, {
    personal: () => createPostgresUniverseRepository(getRuntimeDatabase()),
  });

  return repository;
}
