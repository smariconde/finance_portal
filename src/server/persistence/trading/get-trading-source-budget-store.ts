import "server-only";

import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import { createPostgresTradingSourceBudgetStore } from "@/server/db/trading/postgres-source-budget-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: SourceBudgetStore | undefined;

/**
 * Presupuesto diario y kill switch de las fuentes de Schwab, en la base de
 * trading (ADR 0076): la cuenta no depende de la base de análisis ni para
 * contar su cuota.
 */
export function getTradingSourceBudgetStore(): SourceBudgetStore {
  store ??= createPostgresTradingSourceBudgetStore(
    getTradingDatabaseConnection(),
  );
  return store;
}
