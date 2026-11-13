import "server-only";

import type { SchwabConnectionStore } from "@/modules/trading/application/schwab-connection-store";
import { createPostgresSchwabConnectionStore } from "@/server/db/trading/postgres-schwab-connection-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: SchwabConnectionStore | undefined;

export function getSchwabConnectionStore(): SchwabConnectionStore {
  store ??= createPostgresSchwabConnectionStore(getTradingDatabaseConnection());
  return store;
}
