import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectReitAffoRepository,
  type ReitAffoRepository,
} from "@/modules/valuation/application/reit-affo-repository";
import { createPostgresReitAffoRepository } from "@/server/db/postgres-reit-affo-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: ReitAffoRepository | undefined;

export function getReitAffoRepository(): ReitAffoRepository {
  if (repository) return repository;
  repository = selectReitAffoRepository(getConfigHealth(process.env).mode, {
    personal: () => createPostgresReitAffoRepository(getRuntimeDatabase()),
  });
  return repository;
}
