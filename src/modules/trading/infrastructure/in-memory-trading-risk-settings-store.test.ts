import { describe, expect, it } from "vitest";

import {
  storedSettingsMatch,
  type StoredRiskSettings,
} from "@/modules/trading/application/trading-risk-settings-store";
import {
  DEFAULT_RISK_SETTINGS,
  TRADING_RULES_V1,
} from "@/modules/trading/domain/trading-rules";
import { settingsOf } from "@/server/trading/risk";
import { describeTradingRiskSettingsStoreContract } from "@/modules/trading/application/trading-risk-settings-store.contract";
import { createInMemoryTradingRiskSettingsStore } from "@/modules/trading/infrastructure/in-memory-trading-risk-settings-store";

describeTradingRiskSettingsStoreContract("in memory", () =>
  createInMemoryTradingRiskSettingsStore(),
);

/** Una revisión guardada con `trading-rules-1.0.0`: sin reparto ni riesgo day. */
const LEGACY: StoredRiskSettings = {
  riskPerTradePercent: "1.5",
  openRiskPercent: "5",
  dailyLossPercent: "4",
  maxTradesPerSession: 4,
  maxConsecutiveLosses: 3,
  swingAllocationPercent: null,
  dayRiskPerTradePercent: null,
  revision: 1,
  version: TRADING_RULES_V1,
  recordedAt: "2026-11-15T12:00:00.000Z",
};

describe("a trading-rules-1.0.0 revision", () => {
  it("reads its own values and the defaults for what it did not have", () => {
    expect(settingsOf(LEGACY)).toEqual({
      swingAllocationPercent: "70",
      riskPerTradePercent: "1.5",
      openRiskPercent: "5",
      dayRiskPerTradePercent: "0.5",
      dailyLossPercent: "4",
      maxTradesPerSession: 4,
      maxConsecutiveLosses: 3,
    });
  });

  it("never matches, so saving it writes a complete revision", () => {
    expect(storedSettingsMatch(LEGACY, settingsOf(LEGACY))).toBe(false);
    expect(
      storedSettingsMatch(
        { ...LEGACY, ...DEFAULT_RISK_SETTINGS },
        DEFAULT_RISK_SETTINGS,
      ),
    ).toBe(true);
  });
});
