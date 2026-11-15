import { describeTradingRiskSettingsStoreContract } from "@/modules/trading/application/trading-risk-settings-store.contract";
import { createInMemoryTradingRiskSettingsStore } from "@/modules/trading/infrastructure/in-memory-trading-risk-settings-store";

describeTradingRiskSettingsStoreContract("in memory", () =>
  createInMemoryTradingRiskSettingsStore(),
);
