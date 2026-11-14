import {
  transactionOf,
  type SchwabAccountRecord,
  type SchwabTransactionStore,
  type StoredTransaction,
  type TransactionRun,
  type TransactionSyncState,
} from "@/modules/trading/application/schwab-transaction-store";

/** Doble en memoria del almacén de transacciones: el mismo contrato que PostgreSQL. */
export function createInMemorySchwabTransactionStore(): SchwabTransactionStore {
  const accounts = new Map<string, SchwabAccountRecord>();
  const sync = new Map<string, TransactionSyncState>();
  const revisions: (StoredTransaction & { supersededAt: string | null })[] = [];
  const runs: TransactionRun[] = [];

  return {
    async recordAccount(account) {
      accounts.set(account.accountKey, { ...account });
    },
    async listAccounts() {
      return [...accounts.values()].sort((a, b) =>
        a.accountKey.localeCompare(b.accountKey),
      );
    },
    async readSync(accountKey) {
      return sync.get(accountKey) ?? null;
    },
    async claimSync(accountKey, now, until) {
      if (!accounts.has(accountKey)) {
        throw new Error("The account must be recorded before it syncs.");
      }
      const current = sync.get(accountKey) ?? {
        accountKey,
        historyFrom: null,
        checkedThrough: null,
        claimedUntil: null,
      };
      if (
        current.claimedUntil !== null &&
        Date.parse(current.claimedUntil) > Date.parse(now)
      ) {
        return null;
      }
      const claimed = { ...current, claimedUntil: until };
      sync.set(accountKey, claimed);
      return claimed;
    },
    async listCurrent(accountKey) {
      return revisions
        .filter(
          (row) => row.accountKey === accountKey && row.supersededAt === null,
        )
        .map((row) => ({
          ...transactionOf(row),
          accountKey: row.accountKey,
          revision: row.revision,
          state: row.state,
          contentHash: row.contentHash,
          recordedAt: row.recordedAt,
        }))
        .sort(
          (a, b) =>
            Date.parse(a.executedAt) - Date.parse(b.executedAt) ||
            a.activityId.localeCompare(b.activityId, "en", { numeric: true }),
        );
    },
    async applyRun({
      run,
      claimedUntil,
      revisions: next,
      historyFrom,
      checkedThrough,
    }) {
      const accountKey = run.accountKey!;
      const state = sync.get(accountKey);
      if (state === undefined || state.claimedUntil !== claimedUntil)
        return false;
      for (const revision of next) {
        const previous = revisions.find(
          (row) =>
            row.accountKey === accountKey &&
            row.activityId === revision.transaction.activityId &&
            row.supersededAt === null,
        );
        if ((previous?.revision ?? 0) + 1 !== revision.revision) {
          throw new Error("A revision must follow the current one.");
        }
        if (previous !== undefined) previous.supersededAt = run.finishedAt;
        revisions.push({
          ...revision.transaction,
          accountKey,
          revision: revision.revision,
          state: revision.state,
          contentHash: revision.contentHash,
          recordedAt: run.finishedAt,
          supersededAt: null,
        });
      }
      runs.push(run);
      sync.set(accountKey, {
        accountKey,
        historyFrom,
        checkedThrough,
        claimedUntil: null,
      });
      return true;
    },
    async recordFailedRun(run, claimedUntil) {
      runs.push(run);
      if (run.accountKey === null || claimedUntil === null) return;
      const state = sync.get(run.accountKey);
      if (state?.claimedUntil === claimedUntil) {
        sync.set(run.accountKey, { ...state, claimedUntil: null });
      }
    },
    async listRuns(accountKey, limit) {
      return runs
        .filter((run) => accountKey === null || run.accountKey === accountKey)
        .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
        .slice(0, limit);
    },
  };
}
