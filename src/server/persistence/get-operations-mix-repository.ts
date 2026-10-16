import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectOperationsMixRepository,
  type OperationsMixRepository,
} from "@/modules/valuation/application/operations-mix-repository";
import { createPostgresOperationsMixRepository } from "@/server/db/postgres-operations-mix-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: OperationsMixRepository | undefined;

export function getOperationsMixRepository(): OperationsMixRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectOperationsMixRepository(effectiveMode, {
    personal: () => createPostgresOperationsMixRepository(getRuntimeDatabase()),
  });

  return repository;
}
