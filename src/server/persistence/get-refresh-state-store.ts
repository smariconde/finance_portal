import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectRefreshStateStore,
  type RefreshStateStore,
} from "@/modules/ingestion/application/refresh-state-store";
import { createPostgresRefreshStateStore } from "@/server/db/postgres-refresh-state-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: RefreshStateStore | undefined;

export function getRefreshStateStore(): RefreshStateStore {
  if (store) {
    return store;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  store = selectRefreshStateStore(effectiveMode, {
    personal: () => createPostgresRefreshStateStore(getRuntimeDatabase()),
  });

  return store;
}
