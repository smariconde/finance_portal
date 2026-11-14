import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeEach } from "vitest";

import { describeSourceBudgetStoreContract } from "@/modules/ingestion/application/source-budget-store.contract";
import { describeSchwabConnectionStoreContract } from "@/modules/trading/application/schwab-connection-store.contract";
import { describeSchwabTransactionStoreContract } from "@/modules/trading/application/schwab-transaction-store.contract";
import { createPostgresSchwabConnectionStore } from "@/server/db/trading/postgres-schwab-connection-store";
import { createPostgresSchwabTransactionStore } from "@/server/db/trading/postgres-schwab-transaction-store";
import { createPostgresTradingSourceBudgetStore } from "@/server/db/trading/postgres-source-budget-store";
import * as schema from "@/server/db/trading/schema";

/**
 * Los almacenes de la base de trading pasan los mismos contratos que sus dobles
 * en memoria: el presupuesto, el mismo que el de la base de análisis
 * (ADR 0020), la conexión con Schwab y sus transacciones (ADR 0076).
 */
const client: Sql = postgres(process.env.TRADING_DATABASE_TEST_URL!.trim(), {
  max: 4,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});
const database = drizzle(client, { schema });

beforeEach(async () => {
  await client`delete from schwab_transactions`;
  await client`delete from schwab_transaction_runs`;
  await client`delete from schwab_transaction_sync`;
  await client`delete from schwab_accounts`;
  await client`delete from schwab_connection_events`;
  await client`delete from schwab_connections`;
  await client`delete from schwab_oauth_states`;
});

afterAll(async () => {
  await client.end();
});

describeSourceBudgetStoreContract("trading postgres", {
  createStore: (budgets) =>
    createPostgresTradingSourceBudgetStore(database, budgets),
});

describeSchwabConnectionStoreContract("trading postgres", () =>
  createPostgresSchwabConnectionStore(database),
);

describeSchwabTransactionStoreContract("trading postgres", () =>
  createPostgresSchwabTransactionStore(database),
);
