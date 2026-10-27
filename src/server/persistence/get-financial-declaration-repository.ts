import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { FinancialDeclarationRepository } from "@/modules/valuation/application/financial-declaration-repository";
import { createPostgresFinancialDeclarationRepository } from "@/server/db/postgres-financial-declaration-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: FinancialDeclarationRepository | undefined;

export function getFinancialDeclarationRepository(): FinancialDeclarationRepository {
  if (repository !== undefined) return repository;
  repository = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "financial-declaration-repository",
    () => createPostgresFinancialDeclarationRepository(getRuntimeDatabase()),
  );
  return repository;
}
