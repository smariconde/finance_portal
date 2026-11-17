import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { SurfaceVisitRepository } from "@/modules/surface-visits/application/surface-visit-repository";
import { createPostgresSurfaceVisitRepository } from "@/server/db/postgres-surface-visit-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: SurfaceVisitRepository | undefined;

export function getSurfaceVisitRepository(): SurfaceVisitRepository {
  if (repository) return repository;
  repository = selectPersonalDependency(
    getConfigHealth(process.env).mode,
    "surface-visit-repository",
    () => createPostgresSurfaceVisitRepository(getRuntimeDatabase()),
  );
  return repository;
}
