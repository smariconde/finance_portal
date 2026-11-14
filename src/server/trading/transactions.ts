import "server-only";

import {
  getConfigHealth,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import type { TransactionRun } from "@/modules/trading/application/schwab-transaction-store";
import type { TransactionSyncDependencies } from "@/modules/trading/application/transaction-sync-service";
import {
  buildJournal,
  type JournalSummary,
} from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";
import { getTradingEgressFetch } from "@/server/egress/get-trading-egress-fetch";
import { getSchwabTransactionStore } from "@/server/persistence/trading/get-schwab-transaction-store";

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
  readonly lastRun: TransactionRun | null;
  readonly historyFrom: string | null;
};

/**
 * El diario leído de la base de trading: nunca habla con Schwab. Con una sola
 * cuenta medida, lee la única que hay.
 */
export async function readJournal(): Promise<JournalReading> {
  const store = getSchwabTransactionStore();
  const [accounts, runs] = await Promise.all([
    store.listAccounts(),
    store.listRuns(null, 1),
  ]);
  const account = accounts[0] ?? null;
  const transactions =
    account === null ? [] : await store.listCurrent(account.accountKey);
  const sync =
    account === null ? null : await store.readSync(account.accountKey);
  const { trades, summary } = buildJournal(
    account?.accountKey ?? "",
    transactions,
  );
  return {
    account: account === null ? null : { lastFour: account.lastFour },
    trades,
    summary,
    lastRun: runs[0] ?? null,
    historyFrom: sync?.historyFrom ?? null,
  };
}
