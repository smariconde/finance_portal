"use server";

import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import {
  syncSchwabTransactions,
  transactionsDue,
  type TransactionSyncResult,
} from "@/modules/trading/application/transaction-sync-service";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { safeErrorSummary } from "@/server/trading/safe-error";
import { getTransactionSyncDependencies } from "@/server/trading/transactions";

/** Un booleano y nada más: qué pedir lo decide el servidor (`TM-03`). */
const syncRequestSchema = z.object({ force: z.boolean() }).strict();

export type SyncTransactionsResult =
  | TransactionSyncResult
  /** Lo guardado ya está al día con la cadencia: no salió ningún pedido. */
  | { readonly state: "fresh" }
  | { readonly state: "unavailable" };

/**
 * Pone al día las transacciones de Schwab (`F11-05`,
 * `schwab-transaction-sync-1.0.0`). La página la llama al abrirse; sólo pide si
 * pasó la cadencia (`schwab-transactions-freshness-1.0.0`) o si el owner
 * reintenta. Dos `GET` por la puerta medida en el caso común; la respuesta son
 * conteos y códigos, nunca transacciones ni el número de cuenta.
 */
export async function syncTransactions(
  input: unknown,
): Promise<SyncTransactionsResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = syncRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  try {
    const dependencies = getTransactionSyncDependencies();
    if (
      !request.data.force &&
      !(await transactionsDue(dependencies.store, dependencies.now()))
    ) {
      return { state: "fresh" };
    }
    const result = await syncSchwabTransactions(dependencies);
    if (result.state === "failed" || result.state === "quarantined") {
      console.warn("schwab transactions sync", result.state, result.code);
    }
    return result;
  } catch (error) {
    console.error("schwab transactions sync failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}
