import "server-only";

import type { StoredRiskSettings } from "@/modules/trading/application/trading-risk-settings-store";
import type { PlanLevels } from "@/modules/trading/domain/position-size-risk";
import {
  tradeKeyOf,
  tradeRefOf,
} from "@/modules/trading/domain/trade-annotation";
import {
  DEFAULT_RISK_SETTINGS,
  sessionActivity,
  type RiskSettings,
  type SessionActivity,
} from "@/modules/trading/domain/trading-rules";
import { getTradingRiskSettingsStore } from "@/server/persistence/trading/get-trading-risk-settings-store";
import { ideaLevels } from "@/modules/trading/domain/pre-market-plan";

import { loadJournalState } from "./transactions";

export type RiskContext = {
  readonly settings: RiskSettings;
  /** `null`: rigen los valores por defecto, nunca guardados. */
  readonly settingsRevision: number | null;
  /** Lo planeado para cada trade abierto, por símbolo. */
  readonly plans: readonly (PlanLevels & { readonly symbol: string })[];
  readonly activity: SessionActivity;
};

export function settingsOf(stored: StoredRiskSettings | null): RiskSettings {
  if (stored === null) return DEFAULT_RISK_SETTINGS;
  return {
    riskPerTradePercent: stored.riskPerTradePercent,
    openRiskPercent: stored.openRiskPercent,
    dailyLossPercent: stored.dailyLossPercent,
    maxTradesPerSession: stored.maxTradesPerSession,
    maxConsecutiveLosses: stored.maxConsecutiveLosses,
  };
}

/**
 * Lo que el riesgo de `/cuenta` lee de la base de trading (`F11-09`): las
 * reglas vigentes, el plan de cada trade abierto y la actividad de la sesión de
 * Nueva York. Nunca habla con Schwab: las posiciones y el capital llegan de la
 * lectura de la cuenta.
 */
export async function readRiskContext(now: string): Promise<RiskContext> {
  const [stored, state] = await Promise.all([
    getTradingRiskSettingsStore().readCurrent(),
    loadJournalState(),
  ]);
  const plans = state.trades
    .filter((trade) => trade.status === "open")
    .map((trade) => {
      const tradeKey = tradeKeyOf(trade);
      const plan = state.annotations.get(tradeKey)?.plan ?? null;
      const linked = state.linkedPlans.get(tradeKey);
      const levels = linked === undefined ? null : ideaLevels(linked.idea);
      return {
        symbol: trade.symbol,
        stop: plan?.stop ?? (levels?.state === "valid" ? levels.stop : null),
        target:
          plan?.target ?? (levels?.state === "valid" ? levels.target : null),
        tradeRef: tradeRefOf(tradeKey),
      };
    });
  return {
    settings: settingsOf(stored),
    settingsRevision: stored?.revision ?? null,
    plans,
    activity: sessionActivity(state.trades, now),
  };
}
