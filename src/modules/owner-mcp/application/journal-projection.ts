import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type {
  JournalEntry,
  JournalSummary,
} from "@/modules/trading/domain/journal";
import type {
  PlannedRewardRisk,
  TradeAnnotation,
} from "@/modules/trading/domain/trade-annotation";
import type { RMultiple } from "@/modules/trading/domain/trade-r-multiple";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";

import {
  JOURNAL_SOURCES,
  PORTAL_MCP_TOOLS_VERSION,
} from "../domain/mcp-tool-catalog";
import {
  gate,
  OWNER_ASSISTANT_POLICY_VERSION,
} from "../domain/owner-assistant-rights";

/**
 * El diario como lo lee su página, proyectado para el asistente del owner.
 * Nunca sale la clave de la cuenta (`accountKey`, el HMAC del número) ni el
 * número: sólo sus últimos cuatro dígitos, como en las páginas (ADR 0078,
 * sección 2). Los trades se nombran por su referencia de `/diario/[trade]`.
 */

/** Lo que el diario leído aporta, sin depender de la composición del servidor. */
export type JournalProjectionInput = {
  readonly account: { readonly lastFour: string } | null;
  readonly trades: readonly RoundTrip[];
  readonly summary: JournalSummary;
  readonly entries: Readonly<Record<string, JournalEntry>>;
  readonly lastSyncAt: string | null;
  readonly historyFrom: string | null;
  readonly unread: readonly string[];
};

export type TradeProjectionInput = {
  readonly lastFour: string;
  readonly ref: string;
  readonly trade: RoundTrip;
  readonly annotation:
    | (TradeAnnotation & {
        readonly revision: number;
        readonly recordedAt: string;
      })
    | null;
  readonly linkedPlan: {
    readonly symbol: string;
    readonly setupCode: string | null;
    readonly entry: string;
    readonly stop: string;
    readonly target: string;
    readonly quantity: string;
    readonly notes: string;
  } | null;
  readonly risk:
    | { readonly value: string; readonly reason: null }
    | { readonly value: null; readonly reason: string };
  readonly r: RMultiple;
  readonly rewardRisk: PlannedRewardRisk;
  readonly unread: readonly string[];
};

const envelope = {
  catalogVersion: PORTAL_MCP_TOOLS_VERSION,
  rightsPolicy: OWNER_ASSISTANT_POLICY_VERSION,
} as const;

function tradeSummary(trade: RoundTrip, entry: JournalEntry | undefined) {
  return {
    ref: entry?.ref ?? null,
    symbol: trade.symbol,
    assetType: trade.assetType,
    direction: trade.direction,
    status: trade.status,
    currency: trade.currency,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    openedSession: trade.openedSession,
    closedSession: trade.closedSession,
    dayTrade: trade.dayTrade,
    entryQuantity: trade.entryQuantity,
    openQuantity: trade.openQuantity,
    averageEntryPrice: trade.averageEntryPrice,
    averageExitPrice: trade.averageExitPrice,
    realizedPnl: trade.realizedPnl,
    fees: trade.fees,
    setupCode: entry?.setupCode ?? null,
    review: entry?.review ?? "pending",
    r: entry?.r ?? null,
  };
}

export function projectJournal(
  reading: JournalProjectionInput,
  filter: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly limit: number;
  },
  registry: readonly SourceRegistryEntry[],
) {
  const selected = reading.trades
    .filter(
      (trade) =>
        (filter.from === undefined || trade.openedSession >= filter.from) &&
        (filter.to === undefined || trade.openedSession <= filter.to),
    )
    .toSorted((a, b) => b.openedAt.localeCompare(a.openedAt));

  return {
    ...envelope,
    sources: JOURNAL_SOURCES.map((sourceId) => ({ sourceId })),
    account: reading.account,
    lastSyncAt: reading.lastSyncAt,
    historyFrom: reading.historyFrom,
    unread: reading.unread,
    journal: gate(JOURNAL_SOURCES, registry, () => ({
      summary: {
        closed: reading.summary.closed,
        open: reading.summary.open,
        beforeHistory: reading.summary.beforeHistory,
        winners: reading.summary.winners,
        losers: reading.summary.losers,
        breakeven: reading.summary.breakeven,
        dayTrades: reading.summary.dayTrades,
        swingTrades: reading.summary.swingTrades,
        realizedPnl: reading.summary.realizedPnl,
        fees: reading.summary.fees,
      },
      matching: selected.length,
      truncatedToLimit: selected.length > filter.limit,
      trades: selected
        .slice(0, filter.limit)
        .map((trade) => tradeSummary(trade, reading.entries[trade.tradeId])),
    })),
  };
}

export function projectTrade(
  reading: TradeProjectionInput,
  registry: readonly SourceRegistryEntry[],
) {
  const { trade, annotation } = reading;

  return {
    ...envelope,
    sources: JOURNAL_SOURCES.map((sourceId) => ({ sourceId })),
    account: { lastFour: reading.lastFour },
    unread: reading.unread,
    trade: gate(JOURNAL_SOURCES, registry, () => ({
      ...tradeSummary(trade, undefined),
      ref: reading.ref,
      setupCode: annotation?.setupCode ?? reading.linkedPlan?.setupCode ?? null,
      review: annotation?.review ?? "pending",
      r: reading.r,
      fills: trade.portions.map((portion) => ({
        side: portion.side,
        role: portion.role,
        quantity: portion.quantity,
        price: portion.price,
        netAmount: portion.netAmount,
        executedAt: portion.executedAt,
        realizedPnl: portion.realizedPnl,
      })),
      annotation:
        annotation === null
          ? null
          : {
              revision: annotation.revision,
              recordedAt: annotation.recordedAt,
              plan: annotation.plan,
              adherence: annotation.adherence,
              emotion: annotation.emotion,
              notes: annotation.notes,
            },
      linkedPlan: reading.linkedPlan,
      initialRisk: reading.risk,
      rewardRisk: reading.rewardRisk,
    })),
  };
}
