import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectArgentinaIndicatorRepository,
  type ArgentinaIndicatorRepository,
} from "@/modules/macro-series/application/argentina-indicator-repository";
import { createPostgresArgentinaIndicatorRepository } from "@/server/db/postgres-argentina-indicator-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ArgentinaIndicatorRepository | undefined;

export function getArgentinaIndicatorRepository(): ArgentinaIndicatorRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectArgentinaIndicatorRepository(effectiveMode, {
    personal: () =>
      createPostgresArgentinaIndicatorRepository(getRuntimeDatabase()),
  });

  return repository;
}
