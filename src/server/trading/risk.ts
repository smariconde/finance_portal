import "server-only";

import type {
  StoredRiskSettings,
  TradingRiskSettingsStore,
} from "@/modules/trading/application/trading-risk-settings-store";
import { sessionCashFlows } from "@/modules/trading/domain/account-cash-flows";
import type { PlanLevels } from "@/modules/trading/domain/position-size-risk";
import {
  bookOfTrade,
  type TradingBook,
} from "@/modules/trading/domain/trading-book";
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
import { tradingSessionOf } from "@/modules/trading/domain/trading-session";

import { loadJournalState, type JournalStores } from "./transactions";
import { readPart, unreadParts, type TradingPart } from "./trading-parts";

export type RiskContext = {
  readonly settings: RiskSettings;
  /** `null`: rigen los valores por defecto, nunca guardados. */
  readonly settingsRevision: number | null;
  /**
   * Lo planeado para cada trade abierto, por símbolo, con su tipo
   * (`trading-book-1.0.0`): day si abrió en la sesión de hoy.
   */
  readonly plans: readonly (PlanLevels & {
    readonly symbol: string;
    readonly book: TradingBook;
  })[];
  readonly activity: SessionActivity;
  /**
   * El neto de depósitos y retiros de la sesión (`account-cash-flow-1.0.0`):
   * lo que el cambio del día descuenta para no leerlo como resultado.
   */
  readonly cashFlows: string;
  /**
   * Las partes que la base de trading todavía no tiene (`F11-15`): sin reglas
   * rigen las por defecto, sin planes no hay stop planeado.
   */
  readonly unread: readonly TradingPart[];
};

export type RiskStores = {
  readonly settings: Pick<TradingRiskSettingsStore, "readCurrent">;
  /** Los del diario; por defecto, los de la base de trading del runtime. */
  readonly journal?: JournalStores;
};

/**
 * Las reglas vigentes. Una revisión de `trading-rules-1.0.0` no tenía reparto
 * ni riesgo day: rigen los por defecto hasta que el owner guarde.
 */
export function settingsOf(stored: StoredRiskSettings | null): RiskSettings {
  if (stored === null) return DEFAULT_RISK_SETTINGS;
  return {
    swingAllocationPercent:
      stored.swingAllocationPercent ??
      DEFAULT_RISK_SETTINGS.swingAllocationPercent,
    dayRiskPerTradePercent:
      stored.dayRiskPerTradePercent ??
      DEFAULT_RISK_SETTINGS.dayRiskPerTradePercent,
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
export async function readRiskContext(
  now: string,
  stores: RiskStores = { settings: getTradingRiskSettingsStore() },
): Promise<RiskContext> {
  const unread = new Set<TradingPart>();
  const [stored, state] = await Promise.all([
    readPart(
      "risk_settings",
      unread,
      () => stores.settings.readCurrent(),
      null,
    ),
    loadJournalState(stores.journal),
  ]);
  for (const part of state.unread) unread.add(part);
  const session = tradingSessionOf(now);
  const plans = state.trades
    .filter((trade) => trade.status === "open")
    .map((trade) => {
      const tradeKey = tradeKeyOf(trade);
      const plan = state.annotations.get(tradeKey)?.plan ?? null;
      const linked = state.linkedPlans.get(tradeKey);
      const levels = linked === undefined ? null : ideaLevels(linked.idea);
      return {
        symbol: trade.symbol,
        book: bookOfTrade(trade, session),
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
    cashFlows: sessionCashFlows(state.transactions, now),
    unread: unreadParts(unread),
  };
}
