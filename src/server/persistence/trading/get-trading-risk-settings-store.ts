import "server-only";

import type { TradingRiskSettingsStore } from "@/modules/trading/application/trading-risk-settings-store";
import { createPostgresTradingRiskSettingsStore } from "@/server/db/trading/postgres-trading-risk-settings-store";

import { getTradingDatabaseConnection } from "./get-trading-database";

let store: TradingRiskSettingsStore | undefined;

export function getTradingRiskSettingsStore(): TradingRiskSettingsStore {
  store ??= createPostgresTradingRiskSettingsStore(
    getTradingDatabaseConnection(),
  );
  return store;
}
