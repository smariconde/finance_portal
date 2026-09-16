import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectIngestionJobStore,
  type IngestionJobStore,
} from "@/modules/ingestion/application/ingestion-job-store";
import { createPostgresIngestionJobStore } from "@/server/db/postgres-ingestion-job-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: IngestionJobStore | undefined;

export function getIngestionJobStore(): IngestionJobStore {
  if (store) {
    return store;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  store = selectIngestionJobStore(effectiveMode, {
    personal: () => createPostgresIngestionJobStore(getRuntimeDatabase()),
  });

  return store;
}
