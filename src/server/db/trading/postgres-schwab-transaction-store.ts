import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  SchwabTransactionStore,
  StoredTransaction,
  TransactionRun,
  TransactionSyncState,
} from "@/modules/trading/application/schwab-transaction-store";
import type { SchwabTransaction } from "@/modules/trading/domain/schwab-transactions";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

const key = (hex: string) => Buffer.from(hex, "hex");
const hex = (bytes: Buffer) => Buffer.from(bytes).toString("hex");
const isoOrNull = (value: Date | null) =>
  value === null ? null : value.toISOString();

/** PostgreSQL devuelve `numeric` con la escala guardada: se canoniza al leer. */
function canonical(value: string): string {
  if (!value.includes(".")) return value === "-0" ? "0" : value;
  const trimmed = value.replace(/0+$/u, "").replace(/\.$/u, "");
  return trimmed === "-0" ? "0" : trimmed;
}

function toSync(
  row: typeof schema.schwabTransactionSync.$inferSelect,
): TransactionSyncState {
  return {
    accountKey: hex(row.accountKey),
    historyFrom: isoOrNull(row.historyFrom),
    checkedThrough: isoOrNull(row.checkedThrough),
    claimedUntil: isoOrNull(row.claimedUntil),
  };
}

function toStored(
  row: typeof schema.schwabTransactions.$inferSelect,
): StoredTransaction {
  const transaction: SchwabTransaction = {
    activityId: row.activityId,
    type: row.type as SchwabTransaction["type"],
    status: row.status,
    executedAt: row.executedAt.toISOString(),
    settledAt: isoOrNull(row.settledAt),
    description: row.description,
    orderId: row.orderId,
    positionId: row.positionId,
    netAmount: canonical(row.netAmount),
    fees: row.fees === null ? null : canonical(row.fees),
    instrument:
      row.instrumentId === null
        ? null
        : {
            instrumentId: row.instrumentId,
            symbol: row.symbol!,
            assetType: row.assetType as "EQUITY" | "COLLECTIVE_INVESTMENT",
            instrumentType: row.instrumentType,
            description: row.instrumentDescription,
            quantity: canonical(row.quantity!),
            price: row.price === null ? null : canonical(row.price),
            positionEffect: row.positionEffect as "OPENING" | "CLOSING" | null,
          },
  };
  return {
    ...transaction,
    accountKey: hex(row.accountKey),
    revision: row.revision,
    state: row.state,
    contentHash: row.contentHash,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toRun(
  row: typeof schema.schwabTransactionRuns.$inferSelect,
): TransactionRun {
  return {
    runId: row.runId,
    accountKey: row.accountKey === null ? null : hex(row.accountKey),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    windowFrom: isoOrNull(row.windowFrom),
    windowTo: isoOrNull(row.windowTo),
    requests: row.requests,
    status: row.status,
    code: row.code,
    inserted: row.inserted,
    revised: row.revised,
    withdrawn: row.withdrawn,
    unchanged: row.unchanged,
    parserVersion: row.parserVersion,
  };
}

function runValues(run: TransactionRun) {
  return {
    runId: run.runId,
    accountKey: run.accountKey === null ? null : key(run.accountKey),
    startedAt: new Date(run.startedAt),
    finishedAt: new Date(run.finishedAt),
    windowFrom: run.windowFrom === null ? null : new Date(run.windowFrom),
    windowTo: run.windowTo === null ? null : new Date(run.windowTo),
    requests: run.requests,
    status: run.status,
    code: run.code,
    inserted: run.inserted,
    revised: run.revised,
    withdrawn: run.withdrawn,
    unchanged: run.unchanged,
    parserVersion: run.parserVersion,
  };
}

class ClaimLost extends Error {}

/**
 * Transacciones de Schwab en la base de trading (`F11-05`). El reclamo y la
 * escritura de una corrida son sentencias condicionadas; la corrida se aplica en
 * una transacción corta, sin llamar a Schwab adentro.
 */
export function createPostgresSchwabTransactionStore(
  database: Database,
): SchwabTransactionStore {
  return {
    async recordAccount(account, seenAt) {
      const at = new Date(seenAt);
      await database
        .insert(schema.schwabAccounts)
        .values({
          accountKey: key(account.accountKey),
          lastFour: account.lastFour,
          firstSeenAt: at,
          lastSeenAt: at,
        })
        .onConflictDoUpdate({
          target: schema.schwabAccounts.accountKey,
          set: {
            lastFour: account.lastFour,
            lastSeenAt: sql`greatest(${schema.schwabAccounts.lastSeenAt}, ${seenAt}::timestamptz)`,
          },
        });
    },
    async listAccounts() {
      const rows = await database
        .select()
        .from(schema.schwabAccounts)
        .orderBy(asc(schema.schwabAccounts.accountKey));
      return rows.map((row) => ({
        accountKey: hex(row.accountKey),
        lastFour: row.lastFour,
      }));
    },
    async readSync(accountKey) {
      const [row] = await database
        .select()
        .from(schema.schwabTransactionSync)
        .where(eq(schema.schwabTransactionSync.accountKey, key(accountKey)))
        .limit(1);
      return row ? toSync(row) : null;
    },
    async claimSync(accountKey, now, until) {
      const rows = await database
        .insert(schema.schwabTransactionSync)
        .values({
          accountKey: key(accountKey),
          historyFrom: null,
          checkedThrough: null,
          claimedUntil: new Date(until),
        })
        .onConflictDoUpdate({
          target: schema.schwabTransactionSync.accountKey,
          set: { claimedUntil: new Date(until) },
          setWhere: or(
            isNull(schema.schwabTransactionSync.claimedUntil),
            lte(schema.schwabTransactionSync.claimedUntil, new Date(now)),
          ),
        })
        .returning();
      return rows[0] ? toSync(rows[0]) : null;
    },
    async listCurrent(accountKey) {
      const rows = await database
        .select()
        .from(schema.schwabTransactions)
        .where(
          and(
            eq(schema.schwabTransactions.accountKey, key(accountKey)),
            isNull(schema.schwabTransactions.supersededAt),
          ),
        )
        .orderBy(
          asc(schema.schwabTransactions.executedAt),
          asc(sql`length(${schema.schwabTransactions.activityId})`),
          asc(schema.schwabTransactions.activityId),
        );
      return rows.map(toStored);
    },
    async applyRun({
      run,
      claimedUntil,
      revisions,
      historyFrom,
      checkedThrough,
    }) {
      const accountKey = key(run.accountKey!);
      const at = new Date(run.finishedAt);
      try {
        await database.transaction(async (tx) => {
          const released = await tx
            .update(schema.schwabTransactionSync)
            .set({
              historyFrom: new Date(historyFrom),
              checkedThrough: new Date(checkedThrough),
              claimedUntil: null,
            })
            .where(
              and(
                eq(schema.schwabTransactionSync.accountKey, accountKey),
                eq(
                  schema.schwabTransactionSync.claimedUntil,
                  new Date(claimedUntil),
                ),
              ),
            )
            .returning({ accountKey: schema.schwabTransactionSync.accountKey });
          if (released.length !== 1) throw new ClaimLost();

          for (const {
            transaction: t,
            revision,
            state,
            contentHash,
          } of revisions) {
            if (revision > 1) {
              const superseded = await tx
                .update(schema.schwabTransactions)
                .set({ supersededAt: at })
                .where(
                  and(
                    eq(schema.schwabTransactions.accountKey, accountKey),
                    eq(schema.schwabTransactions.activityId, t.activityId),
                    eq(schema.schwabTransactions.revision, revision - 1),
                    isNull(schema.schwabTransactions.supersededAt),
                  ),
                )
                .returning({ id: schema.schwabTransactions.revisionId });
              if (superseded.length !== 1) {
                throw new Error("A revision must follow the current one.");
              }
            }
            await tx.insert(schema.schwabTransactions).values({
              revisionId: randomUUID(),
              accountKey,
              activityId: t.activityId,
              revision,
              state,
              type: t.type,
              status: t.status,
              executedAt: new Date(t.executedAt),
              settledAt: t.settledAt === null ? null : new Date(t.settledAt),
              description: t.description,
              orderId: t.orderId,
              positionId: t.positionId,
              netAmount: t.netAmount,
              fees: t.fees,
              instrumentId: t.instrument?.instrumentId ?? null,
              symbol: t.instrument?.symbol ?? null,
              assetType: t.instrument?.assetType ?? null,
              instrumentType: t.instrument?.instrumentType ?? null,
              instrumentDescription: t.instrument?.description ?? null,
              quantity: t.instrument?.quantity ?? null,
              price: t.instrument?.price ?? null,
              positionEffect: t.instrument?.positionEffect ?? null,
              contentHash,
              recordedAt: at,
              supersededAt: null,
            });
          }

          await tx.insert(schema.schwabTransactionRuns).values(runValues(run));
        });
      } catch (error) {
        if (error instanceof ClaimLost) return false;
        throw error;
      }
      return true;
    },
    async recordFailedRun(run, claimedUntil) {
      await database
        .insert(schema.schwabTransactionRuns)
        .values(runValues(run));
      if (run.accountKey === null || claimedUntil === null) return;
      await database
        .update(schema.schwabTransactionSync)
        .set({ claimedUntil: null })
        .where(
          and(
            eq(schema.schwabTransactionSync.accountKey, key(run.accountKey)),
            eq(
              schema.schwabTransactionSync.claimedUntil,
              new Date(claimedUntil),
            ),
          ),
        );
    },
    async listRuns(accountKey, limit) {
      const rows = await database
        .select()
        .from(schema.schwabTransactionRuns)
        .where(
          accountKey === null
            ? undefined
            : eq(schema.schwabTransactionRuns.accountKey, key(accountKey)),
        )
        .orderBy(desc(schema.schwabTransactionRuns.finishedAt))
        .limit(limit);
      return rows.map(toRun);
    },
  };
}
