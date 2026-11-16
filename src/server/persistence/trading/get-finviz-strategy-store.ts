import "server-only";

import type { FinvizStrategyStore } from "@/modules/finviz-screener/application/finviz-strategy-store";
import { createPostgresFinvizStrategyStore } from "@/server/db/trading/postgres-finviz-strategy-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: FinvizStrategyStore | undefined;

export function getFinvizStrategyStore(): FinvizStrategyStore {
  store ??= createPostgresFinvizStrategyStore(getTradingDatabaseConnection());
  return store;
}
