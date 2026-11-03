import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectAdrPairRepository,
  type AdrPairRepository,
} from "@/modules/implied-fx/application/adr-pair-repository";
import { createPostgresAdrPairRepository } from "@/server/db/postgres-adr-pair-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: AdrPairRepository | undefined;

export function getAdrPairRepository(): AdrPairRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectAdrPairRepository(effectiveMode, {
    personal: () => createPostgresAdrPairRepository(getRuntimeDatabase()),
  });

  return repository;
}
