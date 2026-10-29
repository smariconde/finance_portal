import "server-only";

import type { BusinessExcerptRepository } from "@/modules/companies/application/business-excerpt-repository";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import { createPostgresBusinessExcerptRepository } from "@/server/db/postgres-business-excerpt-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: BusinessExcerptRepository | undefined;

export function getBusinessExcerptRepository(): BusinessExcerptRepository {
  if (repository) return repository;
  repository = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "business-excerpt-repository",
    () => createPostgresBusinessExcerptRepository(getRuntimeDatabase()),
  );
  return repository;
}
