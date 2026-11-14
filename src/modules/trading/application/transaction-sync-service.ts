import { randomUUID } from "node:crypto";

import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import { schwabAccountKey } from "@/modules/trading/domain/account-key";
import { liveCadence } from "@/modules/trading/domain/live-cadence";
import { parseSchwabAccountNumbers } from "@/modules/trading/domain/schwab-account";
import {
  parseSchwabTransactions,
  SCHWAB_REQUESTED_TRANSACTION_TYPES,
  SCHWAB_TRANSACTIONS_PARSER_VERSION,
  transactionContentHash,
  type SchwabTransaction,
} from "@/modules/trading/domain/schwab-transactions";

import { liveFailureCode } from "./live-account-service";
import {
  transactionOf,
  type SchwabTransactionStore,
  type StoredTransaction,
  type TransactionRevision,
  type TransactionRun,
} from "./schwab-transaction-store";

/**
 * Sincronización de las transacciones de Schwab (`schwab-transaction-sync-1.0.0`,
 * ADR 0076, sección 8 y su enmienda de `F11-05`).
 *
 * Corre dentro de la acción que la pide, bajo un reclamo con vencimiento sobre
 * la fila de la cuenta —como la renovación del token—, y cada corrida queda en
 * un log append-only. Medido: la cuenta tiene ~65 transacciones por año y
 * ponerse al día es un pedido de ~0,4 s, así que no hace falta un worker.
 *
 * - **Primera carga:** ventanas de un año —el máximo que admite Schwab— hacia
 *   atrás hasta la primera vacía (tres años en la cuenta medida), con un techo
 *   de diez.
 * - **Después:** desde lo ya verificado menos 7 días, para ver correcciones.
 * - **Revisiones:** un hash distinto es una revisión nueva; una transacción que
 *   ya no viene en una ventana que la cubría queda `withdrawn`. El primer día de
 *   cada ventana no se usa para dar de baja: Schwab filtra por su propia fecha.
 * - **Cuarentena:** si más de un décimo de lo comparado cambia o desaparece (con
 *   al menos diez), la corrida no escribe y queda `mass_change_guard`.
 */
export const TRANSACTION_SYNC_VERSION = "schwab-transaction-sync-1.0.0";

const TRADER = "https://api.schwabapi.com/trader/v1/accounts";
const DAY_MS = 86_400_000;
const WINDOW_MS = 365 * DAY_MS;
const OVERLAP_MS = 7 * DAY_MS;
const MAX_BACKFILL_WINDOWS = 10;
const CLAIM_MS = 90_000;

export type TransactionSyncDependencies = {
  readonly egress: EgressFetch;
  readonly store: SchwabTransactionStore;
  /** Subclave `account-hmac` derivada de `TRADING_SECRET_KEY`. */
  readonly accountKeySubkey: Buffer;
  readonly now: () => string;
  readonly newId?: () => string;
};

export type TransactionSyncResult =
  | {
      readonly state: "synced";
      readonly inserted: number;
      readonly revised: number;
      readonly withdrawn: number;
      readonly requests: number;
    }
  /** Otro pedido está sincronizando la misma cuenta. */
  | { readonly state: "busy" }
  | { readonly state: "failed"; readonly code: string }
  | { readonly state: "quarantined"; readonly code: "mass_change_guard" };

/**
 * `schwab-transactions-freshness-1.0.0`: hace falta pedir si nunca se pidió o
 * si el último intento tiene más que la cadencia de la cuenta (un minuto en
 * sesión, cinco fuera). Decide sin hablar con Schwab.
 */
export async function transactionsDue(
  store: SchwabTransactionStore,
  now: string,
): Promise<boolean> {
  const [last] = await store.listRuns(null, 1);
  if (last === undefined) return true;
  return (
    Date.parse(now) - Date.parse(last.finishedAt) >= liveCadence(now).accountMs
  );
}

type Window = { readonly from: string; readonly to: string };

function transactionsUrl(hashValue: string, window: Window): string {
  const query = new URLSearchParams({
    startDate: window.from,
    endDate: window.to,
    types: SCHWAB_REQUESTED_TRANSACTION_TYPES.join(","),
  });
  return `${TRADER}/${hashValue}/transactions?${query.toString()}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

class SyncFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SyncFailure";
  }
}

export async function syncSchwabTransactions(
  dependencies: TransactionSyncDependencies,
  options: { readonly acceptMassChange?: boolean } = {},
): Promise<TransactionSyncResult> {
  const newId = dependencies.newId ?? randomUUID;
  const startedAt = dependencies.now();
  let requests = 0;
  let accountKey: string | null = null;
  let claimedUntil: string | null = null;

  const get = async (url: string): Promise<EgressFetchResponse> => {
    requests += 1;
    const response = await dependencies.egress({
      sourceId: "schwab-trader",
      url,
      accept: "application/json",
    });
    if (response.status !== 200)
      throw new SyncFailure(`http_${response.status}`);
    return response;
  };

  const baseRun = (): Omit<TransactionRun, "status" | "code"> => ({
    runId: newId(),
    accountKey,
    startedAt,
    finishedAt: dependencies.now(),
    windowFrom: null,
    windowTo: null,
    requests,
    inserted: 0,
    revised: 0,
    withdrawn: 0,
    unchanged: 0,
    parserVersion: SCHWAB_TRANSACTIONS_PARSER_VERSION,
  });

  // Un reclamo vigente se ve en la base, antes de gastar un pedido en Schwab.
  for (const account of await dependencies.store.listAccounts()) {
    const sync = await dependencies.store.readSync(account.accountKey);
    if (
      sync?.claimedUntil != null &&
      Date.parse(sync.claimedUntil) > Date.parse(startedAt)
    ) {
      return { state: "busy" };
    }
  }

  try {
    const numbers = parseSchwabAccountNumbers(
      (await get(`${TRADER}/accountNumbers`)).body,
    );
    if (!numbers.ok) throw new SyncFailure(numbers.code);
    if (numbers.value.length !== 1) {
      throw new SyncFailure(
        numbers.value.length === 0
          ? "no_account"
          : "multiple_accounts_not_measured",
      );
    }
    const { accountNumber, hashValue } = numbers.value[0]!;
    accountKey = schwabAccountKey(dependencies.accountKeySubkey, accountNumber);
    await dependencies.store.recordAccount(
      { accountKey, lastFour: accountNumber.slice(-4) },
      startedAt,
    );

    const nowMs = Date.parse(startedAt);
    const until = iso(nowMs + CLAIM_MS);
    const state = await dependencies.store.claimSync(
      accountKey,
      startedAt,
      until,
    );
    if (state === null) return { state: "busy" };
    claimedUntil = until;

    const fetchWindow = async (window: Window) => {
      const parsed = parseSchwabTransactions(
        (await get(transactionsUrl(hashValue, window))).body,
      );
      if (!parsed.ok) throw new SyncFailure(parsed.code);
      if (
        parsed.value.accountNumbers.some((number) => number !== accountNumber)
      ) {
        throw new SyncFailure("account_number_mismatch");
      }
      return parsed.value.transactions;
    };

    const fetched: SchwabTransaction[] = [];
    let historyFrom: string;
    let compareFrom: string;

    if (state.historyFrom === null) {
      // Primera carga: hacia atrás hasta una ventana vacía.
      let end = nowMs;
      let windows = 0;
      for (;;) {
        const window = { from: iso(end - WINDOW_MS + 60_000), to: iso(end) };
        const rows = await fetchWindow(window);
        fetched.push(...rows);
        windows += 1;
        historyFrom = window.from;
        if (rows.length === 0 || windows >= MAX_BACKFILL_WINDOWS) break;
        end = Date.parse(window.from);
      }
      compareFrom = historyFrom;
    } else {
      historyFrom = state.historyFrom;
      const checked = Date.parse(state.checkedThrough ?? state.historyFrom);
      let from = Math.max(checked - OVERLAP_MS, Date.parse(historyFrom));
      compareFrom = iso(from);
      while (from < nowMs) {
        const to = Math.min(from + WINDOW_MS - 60_000, nowMs);
        fetched.push(...(await fetchWindow({ from: iso(from), to: iso(to) })));
        from = to;
      }
    }

    const plan = planRevisions({
      stored: await dependencies.store.listCurrent(accountKey),
      fetched,
      // El primer día de la ventana no da de baja (Schwab filtra por su fecha).
      withdrawFrom: iso(Date.parse(compareFrom) + DAY_MS),
      withdrawTo: startedAt,
    });

    const window = { windowFrom: compareFrom, windowTo: startedAt };
    const counts = {
      inserted: plan.inserted,
      revised: plan.revised,
      withdrawn: plan.withdrawn,
      unchanged: plan.unchanged,
    };

    if (
      !options.acceptMassChange &&
      plan.compared >= 10 &&
      (plan.revised + plan.withdrawn) * 10 > plan.compared
    ) {
      await dependencies.store.recordFailedRun(
        {
          ...baseRun(),
          ...window,
          ...counts,
          status: "quarantined",
          code: "mass_change_guard",
        },
        claimedUntil,
      );
      return { state: "quarantined", code: "mass_change_guard" };
    }

    const applied = await dependencies.store.applyRun({
      run: {
        ...baseRun(),
        ...window,
        ...counts,
        status: "succeeded",
        code: null,
      },
      claimedUntil,
      revisions: plan.revisions,
      historyFrom,
      checkedThrough: startedAt,
    });
    if (!applied) return { state: "busy" };

    return {
      state: "synced",
      inserted: plan.inserted,
      revised: plan.revised,
      withdrawn: plan.withdrawn,
      requests,
    };
  } catch (error) {
    const code =
      error instanceof SyncFailure ? error.code : liveFailureCode(error);
    try {
      await dependencies.store.recordFailedRun(
        { ...baseRun(), status: "failed", code },
        claimedUntil,
      );
    } catch {
      // La base de trading tampoco responde: no hay dónde dejar la corrida.
    }
    return { state: "failed", code };
  }
}

/** Qué escribir: revisiones nuevas, contadas por motivo. Pura. */
export function planRevisions(input: {
  readonly stored: readonly StoredTransaction[];
  readonly fetched: readonly SchwabTransaction[];
  readonly withdrawFrom: string;
  readonly withdrawTo: string;
}): {
  readonly revisions: TransactionRevision[];
  readonly inserted: number;
  readonly revised: number;
  readonly withdrawn: number;
  readonly unchanged: number;
  readonly compared: number;
} {
  const stored = new Map(input.stored.map((row) => [row.activityId, row]));
  const seen = new Set<string>();
  const revisions: TransactionRevision[] = [];
  let inserted = 0;
  let revised = 0;
  let unchanged = 0;

  for (const transaction of input.fetched) {
    if (seen.has(transaction.activityId)) continue;
    seen.add(transaction.activityId);
    const contentHash = transactionContentHash(transaction);
    const previous = stored.get(transaction.activityId);
    if (previous === undefined) {
      inserted += 1;
      revisions.push({
        transaction,
        revision: 1,
        state: "recorded",
        contentHash,
      });
    } else if (
      previous.state === "withdrawn" ||
      previous.contentHash !== contentHash
    ) {
      revised += 1;
      revisions.push({
        transaction,
        revision: previous.revision + 1,
        state: "recorded",
        contentHash,
      });
    } else {
      unchanged += 1;
    }
  }

  const from = Date.parse(input.withdrawFrom);
  const to = Date.parse(input.withdrawTo);
  let withdrawn = 0;
  let compared = 0;

  for (const row of input.stored) {
    if (row.state !== "recorded") continue;
    const at = Date.parse(row.executedAt);
    if (at < from || at > to) continue;
    compared += 1;
    if (seen.has(row.activityId)) continue;
    withdrawn += 1;
    revisions.push({
      transaction: transactionOf(row),
      revision: row.revision + 1,
      state: "withdrawn",
      contentHash: row.contentHash,
    });
  }

  return { revisions, inserted, revised, withdrawn, unchanged, compared };
}
