import "server-only";

import {
  selectAiSpendStore,
  type AiSpendStore,
} from "@/modules/ai/application/ai-spend-store";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { createPostgresAiSpendStore } from "@/server/db/postgres-ai-spend-store";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let store: AiSpendStore | undefined;

export function getAiSpendStore(): AiSpendStore {
  if (store) {
    return store;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  store = selectAiSpendStore(effectiveMode, {
    personal: () => createPostgresAiSpendStore(getRuntimeDatabase()),
  });

  return store;
}
