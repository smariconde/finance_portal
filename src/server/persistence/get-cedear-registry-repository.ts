import "server-only";

import {
  selectCedearRegistryRepository,
  type CedearRegistryRepository,
} from "@/modules/cedears/application/cedear-registry-repository";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { createPostgresCedearRegistryRepository } from "@/server/db/postgres-cedear-registry-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: CedearRegistryRepository | undefined;

export function getCedearRegistryRepository(): CedearRegistryRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectCedearRegistryRepository(effectiveMode, {
    personal: () =>
      createPostgresCedearRegistryRepository(getRuntimeDatabase()),
  });

  return repository;
}
