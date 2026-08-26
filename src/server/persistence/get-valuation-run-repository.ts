import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectValuationRunRepository,
  type ValuationRunRepository,
} from "@/modules/valuation/application/valuation-run-repository";
import { createPostgresValuationRunRepository } from "@/server/db/postgres-valuation-run-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ValuationRunRepository | undefined;

export function getValuationRunRepository(): ValuationRunRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectValuationRunRepository(effectiveMode, {
    personal: () => createPostgresValuationRunRepository(getRuntimeDatabase()),
  });

  return repository;
}
