import "server-only";

import type { TradeAnnotationStore } from "@/modules/trading/application/trade-annotation-store";
import { createPostgresTradeAnnotationStore } from "@/server/db/trading/postgres-trade-annotation-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: TradeAnnotationStore | undefined;

export function getTradeAnnotationStore(): TradeAnnotationStore {
  store ??= createPostgresTradeAnnotationStore(getTradingDatabaseConnection());
  return store;
}
