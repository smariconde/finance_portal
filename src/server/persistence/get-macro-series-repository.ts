import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectMacroSeriesRepository,
  type MacroSeriesRepository,
} from "@/modules/macro-series/application/macro-series-repository";
import { createPostgresMacroSeriesRepository } from "@/server/db/postgres-macro-series-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: MacroSeriesRepository | undefined;

export function getMacroSeriesRepository(): MacroSeriesRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectMacroSeriesRepository(effectiveMode, {
    personal: () => createPostgresMacroSeriesRepository(getRuntimeDatabase()),
  });

  return repository;
}
