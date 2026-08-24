import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectValuationRunRepository,
  type ValuationRunRepository,
} from "@/modules/valuation/application/valuation-run-repository";
import { createDemoValuationRunRepository } from "@/modules/valuation/infrastructure/demo-valuation-run-repository";
import { createPostgresValuationRunRepository } from "@/server/db/postgres-valuation-run-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ValuationRunRepository | undefined;

export function getValuationRunRepository(): ValuationRunRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectValuationRunRepository(effectiveMode, {
    // La demo no abre PostgreSQL: sus corridas viven en el proceso.
    demo: createDemoValuationRunRepository,
    personal: () => createPostgresValuationRunRepository(getRuntimeDatabase()),
  });

  return repository;
}
