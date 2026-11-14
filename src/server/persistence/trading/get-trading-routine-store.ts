import "server-only";

import type { TradingRoutineStore } from "@/modules/trading/application/trading-routine-store";
import { createPostgresTradingRoutineStore } from "@/server/db/trading/postgres-trading-routine-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: TradingRoutineStore | undefined;

export function getTradingRoutineStore(): TradingRoutineStore {
  store ??= createPostgresTradingRoutineStore(getTradingDatabaseConnection());
  return store;
}
