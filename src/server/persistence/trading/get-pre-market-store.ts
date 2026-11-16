import "server-only";

import type { PreMarketStore } from "@/modules/trading/application/pre-market-store";
import { createPostgresPreMarketStore } from "@/server/db/trading/postgres-pre-market-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: PreMarketStore | undefined;

export function getPreMarketStore(): PreMarketStore {
  store ??= createPostgresPreMarketStore(getTradingDatabaseConnection());
  return store;
}
