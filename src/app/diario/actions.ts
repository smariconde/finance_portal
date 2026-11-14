"use server";

import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import {
  readOpenDayPnl,
  type OpenDayPnlReading,
} from "@/modules/trading/application/live-account-service";
import {
  syncSchwabTransactions,
  transactionsDue,
  type TransactionSyncResult,
} from "@/modules/trading/application/transaction-sync-service";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
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

const openPnlRequestSchema = z.object({}).strict();

export type OpenPnlResult =
  OpenDayPnlReading | { readonly state: "unavailable" };

/**
 * Lo abierto del día para la franja «Hoy» (`F11-06`, `open-day-pnl-1.0.0`): dos
 * `GET` por la puerta medida, al abrir el diario y cuando el owner lo pide. La
 * respuesta es la suma de Schwab y su hora, nunca posiciones ni la cuenta.
 */
export async function readOpenPnl(input: unknown): Promise<OpenPnlResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  if (!openPnlRequestSchema.safeParse(input).success) {
    return { state: "unavailable" };
  }

  try {
    const reading = await readOpenDayPnl(getLiveAccountDependencies());
    if (reading.state === "failed") {
      console.warn("schwab open pnl read failed", reading.code);
    }
    return reading;
  } catch (error) {
    console.error("schwab open pnl read failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}
