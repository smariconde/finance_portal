import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectEmployeeEquityRepository,
  type EmployeeEquityRepository,
} from "@/modules/valuation/application/employee-equity-repository";
import { createPostgresEmployeeEquityRepository } from "@/server/db/postgres-employee-equity-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: EmployeeEquityRepository | undefined;

export function getEmployeeEquityRepository(): EmployeeEquityRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectEmployeeEquityRepository(effectiveMode, {
    personal: () =>
      createPostgresEmployeeEquityRepository(getRuntimeDatabase()),
  });

  return repository;
}
