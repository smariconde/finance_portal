import "server-only";

import type { SchwabTransactionStore } from "@/modules/trading/application/schwab-transaction-store";
import { createPostgresSchwabTransactionStore } from "@/server/db/trading/postgres-schwab-transaction-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: SchwabTransactionStore | undefined;

export function getSchwabTransactionStore(): SchwabTransactionStore {
  store ??= createPostgresSchwabTransactionStore(
    getTradingDatabaseConnection(),
  );
  return store;
}
