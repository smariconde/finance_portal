import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectSourceBudgetStore,
  type SourceBudgetStore,
} from "@/modules/ingestion/application/source-budget-store";
import { createPostgresSourceBudgetStore } from "@/server/db/postgres-source-budget-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: SourceBudgetStore | undefined;

export function getSourceBudgetStore(): SourceBudgetStore {
  if (store) {
    return store;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  store = selectSourceBudgetStore(effectiveMode, {
    personal: () => createPostgresSourceBudgetStore(getRuntimeDatabase()),
  });

  return store;
}
