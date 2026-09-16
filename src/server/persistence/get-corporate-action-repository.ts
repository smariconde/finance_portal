import "server-only";

import {
  selectCorporateActionRepository,
  type CorporateActionRepository,
} from "@/modules/corporate-actions/application/corporate-action-repository";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { createPostgresCorporateActionRepository } from "@/server/db/postgres-corporate-action-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: CorporateActionRepository | undefined;

export function getCorporateActionRepository(): CorporateActionRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectCorporateActionRepository(effectiveMode, {
    personal: () =>
      createPostgresCorporateActionRepository(getRuntimeDatabase()),
  });

  return repository;
}
