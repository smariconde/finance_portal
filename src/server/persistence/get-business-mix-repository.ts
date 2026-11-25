import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectBusinessMixRepository,
  type BusinessMixRepository,
} from "@/modules/valuation/application/business-mix-repository";
import { createPostgresBusinessMixRepository } from "@/server/db/postgres-business-mix-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: BusinessMixRepository | undefined;

export function getBusinessMixRepository(): BusinessMixRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectBusinessMixRepository(effectiveMode, {
    personal: () => createPostgresBusinessMixRepository(getRuntimeDatabase()),
  });

  return repository;
}
