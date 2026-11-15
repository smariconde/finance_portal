import { describe, expect, it } from "vitest";

import {
  DEFAULT_RISK_SETTINGS,
  TRADING_RULES_VERSION,
  type RiskSettings,
} from "@/modules/trading/domain/trading-rules";

import type { TradingRiskSettingsStore } from "./trading-risk-settings-store";

/**
 * Contrato del almacén de las reglas, contra el doble en memoria (unitario) y
 * contra PostgreSQL (integración de trading).
 */
const T0 = "2026-11-15T12:00:00.000Z";
const T1 = "2026-11-15T12:01:00.000Z";

export function describeTradingRiskSettingsStoreContract(
  label: string,
  createStore: () => TradingRiskSettingsStore,
): void {
  describe(`trading risk settings store contract (${label})`, () => {
    const save = (
      store: TradingRiskSettingsStore,
      baseRevision: number | null,
      settings: RiskSettings,
      recordedAt = T0,
    ) =>
      store.save({
        baseRevision,
        settings,
        version: TRADING_RULES_VERSION,
        recordedAt,
      });

    it("has nothing until the owner saves", async () => {
      expect(await createStore().readCurrent()).toBeNull();
    });

    it("saves revisions and keeps the latest current", async () => {
      const store = createStore();
      const first = await save(store, null, DEFAULT_RISK_SETTINGS);
      expect(first).toMatchObject({
        state: "saved",
        settings: { revision: 1, ...DEFAULT_RISK_SETTINGS, recordedAt: T0 },
      });
      const second = await save(
        store,
        1,
        {
          ...DEFAULT_RISK_SETTINGS,
          riskPerTradePercent: "1.5",
          dailyLossPercent: null,
          maxTradesPerSession: null,
        },
        T1,
      );
      expect(second.state).toBe("saved");
      expect(await store.readCurrent()).toEqual({
        ...DEFAULT_RISK_SETTINGS,
        riskPerTradePercent: "1.5",
        dailyLossPercent: null,
        maxTradesPerSession: null,
        revision: 2,
        version: TRADING_RULES_VERSION,
        recordedAt: T1,
      });
    });

    it("does not write the same settings twice", async () => {
      const store = createStore();
      await save(store, null, DEFAULT_RISK_SETTINGS);
      const again = await save(store, 1, { ...DEFAULT_RISK_SETTINGS }, T1);
      expect(again).toMatchObject({
        state: "unchanged",
        settings: { revision: 1, recordedAt: T0 },
      });
    });

    it("refuses to write over a revision it did not read", async () => {
      const store = createStore();
      await save(store, null, DEFAULT_RISK_SETTINGS);
      const stale = await save(store, null, {
        ...DEFAULT_RISK_SETTINGS,
        openRiskPercent: "8",
      });
      expect(stale).toMatchObject({
        state: "conflict",
        current: { revision: 1, openRiskPercent: "6" },
      });
      expect(
        (
          await save(store, 2, {
            ...DEFAULT_RISK_SETTINGS,
            openRiskPercent: "8",
          })
        ).state,
      ).toBe("conflict");
    });
  });
}
