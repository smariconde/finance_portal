import "server-only";

import {
  selectConsensusRepository,
  type ConsensusRepository,
} from "@/modules/consensus/application/consensus-repository";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { createPostgresConsensusRepository } from "@/server/db/postgres-consensus-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ConsensusRepository | undefined;

export function getConsensusRepository(): ConsensusRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectConsensusRepository(effectiveMode, {
    personal: () => createPostgresConsensusRepository(getRuntimeDatabase()),
  });

  return repository;
}
