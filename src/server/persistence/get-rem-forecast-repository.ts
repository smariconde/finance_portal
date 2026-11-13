import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { RemForecastRepository } from "@/modules/macro-series/application/rem-forecast-repository";
import { createPostgresRemForecastRepository } from "@/server/db/postgres-rem-forecast-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: RemForecastRepository | undefined;

export function getRemForecastRepository(): RemForecastRepository {
  if (repository) return repository;
  repository = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "rem-forecast-repository",
    () => createPostgresRemForecastRepository(getRuntimeDatabase()),
  );
  return repository;
}
