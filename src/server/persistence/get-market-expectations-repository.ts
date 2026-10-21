import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectMarketExpectationsRepository,
  type MarketExpectationsRepository,
} from "@/modules/valuation/application/market-expectations-repository";
import { createPostgresMarketExpectationsRepository } from "@/server/db/postgres-market-expectations-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: MarketExpectationsRepository | undefined;

export function getMarketExpectationsRepository(): MarketExpectationsRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectMarketExpectationsRepository(effectiveMode, {
    personal: () =>
      createPostgresMarketExpectationsRepository(getRuntimeDatabase()),
  });

  return repository;
}
