import "server-only";

import {
  getConfigHealth,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import type {
  SchwabTransactionStore,
  TransactionRun,
} from "@/modules/trading/application/schwab-transaction-store";
import type {
  StoredAnnotation,
  TradeAnnotationStore,
} from "@/modules/trading/application/trade-annotation-store";
import type {
  IdeaLink,
  PreMarketStore,
  StoredIdea,
} from "@/modules/trading/application/pre-market-store";
import type { TransactionSyncDependencies } from "@/modules/trading/application/transaction-sync-service";
import {
  calendarBook,
  sessionExits,
  type CalendarBook,
} from "@/modules/trading/domain/daily-pnl";
import {
  buildJournal,
  type JournalEntry,
  type JournalSummary,
} from "@/modules/trading/domain/journal";
import {
  plannedStopOf,
  tradeKeyOf,
  tradeRefOf,
} from "@/modules/trading/domain/trade-annotation";
import {
  rMultipleOf,
  type PlannedStop,
} from "@/modules/trading/domain/trade-r-multiple";
import { tradeReturnOf } from "@/modules/trading/domain/trade-return";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import { tradingSessionOf } from "@/modules/trading/domain/trading-session";
import {
  setupCatalog,
  type TradingSetup,
} from "@/modules/trading/domain/trading-setups";
import {
  tradingStats,
  type TradingStats,
} from "@/modules/trading/domain/trading-stats";
import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";
import { getTradingEgressFetch } from "@/server/egress/get-trading-egress-fetch";
import { getSchwabTransactionStore } from "@/server/persistence/trading/get-schwab-transaction-store";
import { getTradeAnnotationStore } from "@/server/persistence/trading/get-trade-annotation-store";
import { getPreMarketStore } from "@/server/persistence/trading/get-pre-market-store";
import { ideaLevels } from "@/modules/trading/domain/pre-market-plan";

import { SchwabUnavailableError } from "./schwab-connection";
import { readPart, unreadParts, type TradingPart } from "./trading-parts";

/** Raíz de composición de la sincronización de transacciones (`F11-05`). */
export function getTransactionSyncDependencies(): TransactionSyncDependencies {
  const health = getConfigHealth(process.env);
  if (!servesSchwabConnection(health)) throw new SchwabUnavailableError();

  const key = parseTradingSecretKey(process.env.TRADING_SECRET_KEY);
  if (!key.ok) throw new SchwabUnavailableError();

  return {
    egress: getTradingEgressFetch(),
    store: getSchwabTransactionStore(),
    accountKeySubkey: deriveTradingSubkey(key.key, "account-hmac"),
    now: () => new Date().toISOString(),
  };
}

export type JournalReading = {
  readonly account: { readonly lastFour: string } | null;
  readonly trades: readonly RoundTrip[];
  readonly summary: JournalSummary;
  /** P&L por sesión de Nueva York, de la primera salida a hoy (`F11-06`). */
  readonly calendar: CalendarBook;
  /** Por `tradeId`: la anotación vigente resumida, o el trade sin anotar. */
  readonly entries: Readonly<Record<string, JournalEntry>>;
  readonly setups: readonly TradingSetup[];
  readonly lastRun: TransactionRun | null;
  readonly historyFrom: string | null;
  /** Lo que la base de trading todavía no tiene (`F11-15`). */
  readonly unread: readonly TradingPart[];
};

export type JournalState = {
  readonly account: {
    readonly accountKey: string;
    readonly lastFour: string;
  } | null;
  readonly trades: readonly RoundTrip[];
  readonly summary: JournalSummary;
  /** Por clave de trade (`schwab:<instrumentId>:<fillId>`). */
  readonly annotations: ReadonlyMap<string, StoredAnnotation>;
  readonly linkedPlans: ReadonlyMap<
    string,
    { readonly link: IdeaLink; readonly idea: StoredIdea }
  >;
  readonly setups: readonly TradingSetup[];
  /** Las partes que no se leyeron porque su tabla no existe (`F11-15`). */
  readonly unread: readonly TradingPart[];
};

export type JournalStores = {
  readonly transactions: Pick<
    SchwabTransactionStore,
    "listAccounts" | "listCurrent"
  >;
  readonly annotations: Pick<
    TradeAnnotationStore,
    "listOwnSetups" | "listCurrentAnnotations"
  >;
  readonly preMarket: Pick<PreMarketStore, "listLinks">;
};

function journalStores(): JournalStores {
  return {
    transactions: getSchwabTransactionStore(),
    annotations: getTradeAnnotationStore(),
    preMarket: getPreMarketStore(),
  };
}

/**
 * Las transacciones, los trades y sus anotaciones, todo de la base de trading:
 * nunca habla con Schwab. Con una sola cuenta medida, lee la única que hay. Las
 * anotaciones y los planes de antes de la rueda son partes: sin su tabla, el
 * diario se lee sin ellas y las nombra en `unread`.
 */
export async function loadJournalState(
  stores: JournalStores = journalStores(),
): Promise<JournalState> {
  const unread = new Set<TradingPart>();
  const [accounts, ownSetups] = await Promise.all([
    stores.transactions.listAccounts(),
    readPart(
      "annotations",
      unread,
      () => stores.annotations.listOwnSetups(),
      [],
    ),
  ]);
  const account = accounts[0] ?? null;
  const [transactions, annotations, linkedPlans] =
    account === null
      ? [[], [], new Map()]
      : await Promise.all([
          stores.transactions.listCurrent(account.accountKey),
          readPart(
            "annotations",
            unread,
            () => stores.annotations.listCurrentAnnotations(account.accountKey),
            [],
          ),
          readPart(
            "pre_market",
            unread,
            () => stores.preMarket.listLinks(account.accountKey),
            new Map(),
          ),
        ]);
  const { trades, summary } = buildJournal(
    account?.accountKey ?? "",
    transactions,
  );
  return {
    account,
    trades,
    summary,
    annotations: new Map(
      annotations.map((stored) => [stored.tradeKey, stored]),
    ),
    linkedPlans,
    setups: setupCatalog(ownSetups),
    unread: unreadParts(unread),
  };
}

/** El stop planeado de cada trade, por `tradeId`, como lo pide R. */
export function plannedStops(
  state: Pick<JournalState, "trades" | "annotations" | "linkedPlans">,
): Map<string, PlannedStop> {
  const stops = new Map<string, PlannedStop>();
  for (const trade of state.trades) {
    let stop = plannedStopOf(
      state.annotations.get(tradeKeyOf(trade)) ?? null,
      trade.currency,
    );
    if (stop === null) {
      const linked = state.linkedPlans.get(tradeKeyOf(trade));
      const levels = linked === undefined ? null : ideaLevels(linked.idea);
      if (levels?.state === "valid" && trade.currency === "USD")
        stop = { price: levels.stop, currency: "USD" };
    }
    if (stop !== null) stops.set(trade.tradeId, stop);
  }
  return stops;
}

/** El diario leído de la base de trading, con R donde el owner planeó un stop. */
export async function readJournal(): Promise<JournalReading> {
  const [state, runs] = await Promise.all([
    loadJournalState(),
    getSchwabTransactionStore().listRuns(null, 1),
  ]);
  const sync =
    state.account === null
      ? null
      : await getSchwabTransactionStore().readSync(state.account.accountKey);
  const stops = plannedStops(state);
  const now = new Date().toISOString();
  const calendar = calendarBook(
    sessionExits(state.trades, stops),
    tradingSessionOf(now),
  );
  const entries: Record<string, JournalEntry> = {};
  for (const trade of state.trades) {
    const tradeKey = tradeKeyOf(trade);
    const annotation = state.annotations.get(tradeKey) ?? null;
    entries[trade.tradeId] = {
      ref: tradeRefOf(tradeKey),
      setupCode:
        annotation?.setupCode ??
        state.linkedPlans.get(tradeKey)?.idea.setupCode ??
        null,
      review: annotation?.review ?? "pending",
      r: rMultipleOf(trade, stops.get(trade.tradeId) ?? null),
      return: tradeReturnOf(trade),
    };
  }
  return {
    account:
      state.account === null ? null : { lastFour: state.account.lastFour },
    trades: state.trades,
    summary: state.summary,
    calendar,
    entries,
    setups: state.setups,
    lastRun: runs[0] ?? null,
    historyFrom: sync?.historyFrom ?? null,
    unread: state.unread,
  };
}

export type TradingStatsReading = {
  readonly account: { readonly lastFour: string } | null;
  readonly stats: TradingStats;
  readonly setups: readonly TradingSetup[];
  readonly unread: readonly TradingPart[];
};

/**
 * Las estadísticas del diario (`F11-08`, `trading-stats-1.0.0`): los mismos
 * trades, stops y salidas que lee el diario, de la base de trading y nada más.
 */
export async function readTradingStats(): Promise<TradingStatsReading> {
  const state = await loadJournalState();
  const stops = plannedStops(state);
  const stats = tradingStats(
    state.trades.map((trade) => ({
      ...trade,
      setupCode:
        state.annotations.get(tradeKeyOf(trade))?.setupCode ??
        state.linkedPlans.get(tradeKeyOf(trade))?.idea.setupCode ??
        null,
      r: rMultipleOf(trade, stops.get(trade.tradeId) ?? null),
    })),
    sessionExits(state.trades, stops),
  );
  return {
    account:
      state.account === null ? null : { lastFour: state.account.lastFour },
    stats,
    setups: state.setups,
    unread: state.unread,
  };
}
