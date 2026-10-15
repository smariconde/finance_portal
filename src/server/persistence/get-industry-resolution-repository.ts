import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectIndustryResolutionRepository,
  type IndustryResolutionRepository,
} from "@/modules/valuation/application/industry-resolution-repository";
import { createPostgresIndustryResolutionRepository } from "@/server/db/postgres-industry-resolution-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: IndustryResolutionRepository | undefined;

export function getIndustryResolutionRepository(): IndustryResolutionRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectIndustryResolutionRepository(effectiveMode, {
    personal: () =>
      createPostgresIndustryResolutionRepository(getRuntimeDatabase()),
  });

  return repository;
}
