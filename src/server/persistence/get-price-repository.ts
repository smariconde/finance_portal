import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectPriceRepository,
  type PriceRepository,
} from "@/modules/prices/application/price-repository";
import { createPostgresPriceRepository } from "@/server/db/postgres-price-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: PriceRepository | undefined;

export function getPriceRepository(): PriceRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectPriceRepository(effectiveMode, {
    personal: () => createPostgresPriceRepository(getRuntimeDatabase()),
  });

  return repository;
}
