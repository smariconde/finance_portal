import "server-only";

import {
  getConfigHealth,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import type { TransactionRun } from "@/modules/trading/application/schwab-transaction-store";
import type { StoredAnnotation } from "@/modules/trading/application/trade-annotation-store";
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
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import { tradingSessionOf } from "@/modules/trading/domain/trading-session";
import type { RoutineReading } from "@/modules/trading/domain/trading-routine";
import {
  setupCatalog,
  type TradingSetup,
} from "@/modules/trading/domain/trading-setups";
import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";
import { getTradingEgressFetch } from "@/server/egress/get-trading-egress-fetch";
import { getSchwabTransactionStore } from "@/server/persistence/trading/get-schwab-transaction-store";
import { getTradeAnnotationStore } from "@/server/persistence/trading/get-trade-annotation-store";

import {
  readRoutine,
  routineSessionOf,
  routineSessionsBetween,
} from "./routine";
import { SchwabUnavailableError } from "./schwab-connection";

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
  /** La rutina de la sesión que toca ahora (`F11-07`). */
  readonly routine: RoutineReading;
  /** Sesiones del calendario con rutina hecha. */
  readonly routineSessions: readonly string[];
  readonly lastRun: TransactionRun | null;
  readonly historyFrom: string | null;
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
  readonly setups: readonly TradingSetup[];
};

/**
 * Las transacciones, los trades y sus anotaciones, todo de la base de trading:
 * nunca habla con Schwab. Con una sola cuenta medida, lee la única que hay.
 */
export async function loadJournalState(): Promise<JournalState> {
  const store = getSchwabTransactionStore();
  const annotationStore = getTradeAnnotationStore();
  const [accounts, ownSetups] = await Promise.all([
    store.listAccounts(),
    annotationStore.listOwnSetups(),
  ]);
  const account = accounts[0] ?? null;
  const [transactions, annotations] =
    account === null
      ? [[], []]
      : await Promise.all([
          store.listCurrent(account.accountKey),
          annotationStore.listCurrentAnnotations(account.accountKey),
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
    setups: setupCatalog(ownSetups),
  };
}

/** El stop planeado de cada trade, por `tradeId`, como lo pide R. */
export function plannedStops(
  state: Pick<JournalState, "trades" | "annotations">,
): Map<string, PlannedStop> {
  const stops = new Map<string, PlannedStop>();
  for (const trade of state.trades) {
    const stop = plannedStopOf(
      state.annotations.get(tradeKeyOf(trade)) ?? null,
      trade.currency,
    );
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
  const routineSession = routineSessionOf(now);
  const [routine, routineSessions] = await Promise.all([
    readRoutine(routineSession, now),
    routineSessionsBetween(
      `${calendar.months[0]?.month ?? routineSession.slice(0, 7)}-01`,
      routineSession,
    ),
  ]);
  const entries: Record<string, JournalEntry> = {};
  for (const trade of state.trades) {
    const tradeKey = tradeKeyOf(trade);
    const annotation = state.annotations.get(tradeKey) ?? null;
    entries[trade.tradeId] = {
      ref: tradeRefOf(tradeKey),
      setupCode: annotation?.setupCode ?? null,
      review: annotation?.review ?? "pending",
      r: rMultipleOf(trade, stops.get(trade.tradeId) ?? null),
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
    routine,
    routineSessions,
    lastRun: runs[0] ?? null,
    historyFrom: sync?.historyFrom ?? null,
  };
}
