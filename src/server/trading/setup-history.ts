import "server-only";

import {
  tradeKeyOf,
  tradeRefOf,
} from "@/modules/trading/domain/trade-annotation";
import {
  rMultipleOf,
  type RMultiple,
} from "@/modules/trading/domain/trade-r-multiple";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import {
  tradeStatsOf,
  type TradeStats,
} from "@/modules/trading/domain/trading-stats";

import { loadJournalState, plannedStops } from "./transactions";

export type SetupTrade = {
  /** `<instrumentId>-<fillId>`, la URL del trade en el diario. */
  readonly ref: string;
  readonly symbol: string;
  readonly status: "open" | "closed" | "opened_before_history";
  readonly openedSession: string;
  readonly closedSession: string | null;
  readonly dayTrade: boolean;
  readonly realizedPnl: string | null;
  readonly r: RMultiple;
};

export type SetupHistory = {
  readonly hasAccount: boolean;
  readonly currency: string | null;
  /** Sólo los trades cerrados, con `trading-stats-1.0.0`; `null` sin ninguno. */
  readonly stats: TradeStats | null;
  /** Los etiquetados con el setup, del más reciente al más viejo. */
  readonly trades: readonly SetupTrade[];
};

type Tagged = {
  readonly trade: RoundTrip;
  readonly setupCode: string;
  readonly r: RMultiple;
};

/**
 * Cómo le va al owner con cada setup (`F11-10`): los trades que etiquetó en el
 * diario, leídos de la base de trading y nada más. Es la misma lectura que las
 * estadísticas, cortada por setup; un setup en dos monedas no se suma.
 */
async function loadTagged(): Promise<{
  hasAccount: boolean;
  tagged: Tagged[];
}> {
  const state = await loadJournalState();
  const stops = plannedStops(state);
  const tagged = state.trades.flatMap((trade) => {
    const setupCode = state.annotations.get(tradeKeyOf(trade))?.setupCode;
    if (setupCode == null) return [];
    return [
      {
        trade,
        setupCode,
        r: rMultipleOf(trade, stops.get(trade.tradeId) ?? null),
      },
    ];
  });
  return { hasAccount: state.account !== null, tagged };
}

function statsOf(tagged: readonly Tagged[]): {
  currency: string | null;
  stats: TradeStats | null;
} {
  const currencies = [...new Set(tagged.map((item) => item.trade.currency))];
  if (currencies.length > 1) return { currency: null, stats: null };
  return {
    currency: currencies[0] ?? null,
    stats: tradeStatsOf(
      tagged
        .filter((item) => item.trade.status === "closed")
        .map((item) => ({
          ...item.trade,
          setupCode: item.setupCode,
          r: item.r,
        })),
    ),
  };
}

export async function readSetupHistory(code: string): Promise<SetupHistory> {
  const { hasAccount, tagged } = await loadTagged();
  const own = tagged.filter((item) => item.setupCode === code);
  return {
    hasAccount,
    ...statsOf(own),
    trades: own
      .toSorted((a, b) => b.trade.openedAt.localeCompare(a.trade.openedAt))
      .map(({ trade, r }) => ({
        ref: tradeRefOf(tradeKeyOf(trade)),
        symbol: trade.symbol,
        status: trade.status,
        openedSession: trade.openedSession,
        closedSession: trade.closedSession,
        dayTrade: trade.dayTrade,
        realizedPnl: trade.realizedPnl,
        r,
      })),
  };
}

export type SetupSummary = {
  readonly tagged: number;
  readonly stats: TradeStats | null;
};

/** Por código de setup: cuántos trades etiquetados y sus cifras de cerrados. */
export async function readSetupSummaries(): Promise<{
  readonly hasAccount: boolean;
  readonly currency: string | null;
  readonly bySetup: Readonly<Record<string, SetupSummary>>;
}> {
  const { hasAccount, tagged } = await loadTagged();
  const groups = new Map<string, Tagged[]>();
  for (const item of tagged) {
    const group = groups.get(item.setupCode);
    if (group === undefined) groups.set(item.setupCode, [item]);
    else group.push(item);
  }
  const currencies = [...new Set(tagged.map((item) => item.trade.currency))];
  return {
    hasAccount,
    currency: currencies.length === 1 ? currencies[0]! : null,
    bySetup: Object.fromEntries(
      [...groups.entries()].map(([code, group]) => [
        code,
        { tagged: group.length, stats: statsOf(group).stats },
      ]),
    ),
  };
}
