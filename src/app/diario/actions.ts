"use server";

import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import {
  readOpenDayPnl,
  type OpenDayPnlReading,
} from "@/modules/trading/application/live-account-service";
import {
  readTradeChart,
  type TradeChartReading,
} from "@/modules/trading/application/trade-chart-service";
import {
  syncSchwabTransactions,
  transactionsDue,
  type TransactionSyncResult,
} from "@/modules/trading/application/transaction-sync-service";
import {
  adherenceMarkSchema,
  emotionSchema,
  notesSchema,
  priceInputSchema,
  quantityInputSchema,
  reviewStatusSchema,
  TRADE_ANNOTATION_VERSION,
  tradeKeyFromRef,
  tradeKeyOf,
  tradeRefSchema,
} from "@/modules/trading/domain/trade-annotation";
import {
  MAX_OWN_SETUPS,
  ownSetupCodeOf,
  ownSetupLabelSchema,
  setupCodeSchema,
} from "@/modules/trading/domain/trading-setups";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getTradeAnnotationStore } from "@/server/persistence/trading/get-trade-annotation-store";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { safeErrorSummary } from "@/server/trading/safe-error";
import {
  getTransactionSyncDependencies,
  loadJournalState,
} from "@/server/trading/transactions";

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

/**
 * Un campo del formulario por clave y nada más (`TM-03`): el trade llega por el
 * segmento de su URL, nunca por la cuenta ni un ticker, y precios y notas pasan
 * por los mismos schemas que el dominio.
 */
const annotationRequestSchema = z
  .object({
    ref: tradeRefSchema,
    baseRevision: z.number().int().min(1).max(1_000_000).nullable(),
    setupCode: setupCodeSchema.nullable(),
    plan: z
      .object({
        entry: priceInputSchema,
        stop: priceInputSchema,
        target: priceInputSchema,
        quantity: quantityInputSchema,
      })
      .strict(),
    adherence: z
      .object({
        entry: adherenceMarkSchema,
        stop: adherenceMarkSchema,
        target: adherenceMarkSchema,
        size: adherenceMarkSchema,
      })
      .strict(),
    emotion: emotionSchema,
    review: reviewStatusSchema,
    notes: notesSchema,
  })
  .strict();

export type SaveAnnotationResult =
  | { readonly state: "saved"; readonly revision: number }
  | { readonly state: "unchanged"; readonly revision: number }
  /** Otra pestaña u otro equipo guardó antes: hay que recargar. */
  | { readonly state: "conflict" }
  /** El primer campo que no pasa, por su camino; nunca el valor. */
  | { readonly state: "invalid"; readonly field: string }
  | { readonly state: "not_found" }
  | { readonly state: "unavailable" };

/**
 * Guarda la anotación de un trade (`F11-07`, `trade-annotation-1.0.0`) como
 * revisión nueva. Sólo escribe en la base de trading; no habla con Schwab.
 */
export async function saveTradeAnnotation(
  input: unknown,
): Promise<SaveAnnotationResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = annotationRequestSchema.safeParse(input);
  if (!request.success) {
    const path = request.error.issues[0]?.path.join(".") ?? "";
    return {
      state: "invalid",
      field: /^[a-z.]{0,40}$/iu.test(path) ? path : "",
    };
  }

  try {
    const { ref, baseRevision, ...annotation } = request.data;
    const tradeKey = tradeKeyFromRef(ref);
    const state = await loadJournalState();
    const trade =
      tradeKey === null
        ? undefined
        : state.trades.find((candidate) => tradeKeyOf(candidate) === tradeKey);
    if (state.account === null || tradeKey === null || trade === undefined) {
      return { state: "not_found" };
    }
    if (
      annotation.setupCode !== null &&
      !state.setups.some((setup) => setup.code === annotation.setupCode)
    ) {
      return { state: "invalid", field: "setupCode" };
    }

    const result = await getTradeAnnotationStore().saveAnnotation({
      accountKey: state.account.accountKey,
      tradeKey,
      baseRevision,
      annotation,
      version: TRADE_ANNOTATION_VERSION,
      recordedAt: new Date().toISOString(),
    });
    if (result.state === "conflict") return { state: "conflict" };
    return { state: result.state, revision: result.annotation.revision };
  } catch (error) {
    console.error("trade annotation save failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

const ownSetupRequestSchema = z.object({ label: ownSetupLabelSchema }).strict();

export type CreateSetupResult =
  | {
      readonly state: "created" | "exists";
      readonly code: string;
      readonly label: string;
    }
  | { readonly state: "limit_reached" | "invalid" | "unavailable" };

/** Suma un setup propio al catálogo (`trading-setups-1.0.0`). */
export async function createOwnSetup(
  input: unknown,
): Promise<CreateSetupResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = ownSetupRequestSchema.safeParse(input);
  if (!request.success) return { state: "invalid" };
  const code = ownSetupCodeOf(request.data.label);
  if (code === null) return { state: "invalid" };

  try {
    const result = await getTradeAnnotationStore().createOwnSetup(
      { code, label: request.data.label, createdAt: new Date().toISOString() },
      MAX_OWN_SETUPS,
    );
    if (result === "limit_reached") return { state: result };
    return { state: result, code, label: request.data.label };
  } catch (error) {
    console.error("own setup create failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

const chartRequestSchema = z.object({ ref: tradeRefSchema }).strict();

export type TradeChartResult =
  | TradeChartReading
  | { readonly state: "not_found" }
  | { readonly state: "unavailable" };

/**
 * Las velas del trade para su gráfico (`F11-07`, `trade-chart-1.0.0`): uno o dos
 * `GET` a `schwab-marketdata` al abrir el trade. Se muestran y no se guardan; la
 * respuesta son velas, marcas y la resolución, nunca la cuenta.
 */
export async function loadTradeChart(
  input: unknown,
): Promise<TradeChartResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = chartRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  try {
    const tradeKey = tradeKeyFromRef(request.data.ref);
    const state = await loadJournalState();
    const trade =
      tradeKey === null
        ? undefined
        : state.trades.find((candidate) => tradeKeyOf(candidate) === tradeKey);
    if (trade === undefined) return { state: "not_found" };
    const { egress, now } = getLiveAccountDependencies();
    const reading = await readTradeChart({ egress, now }, trade);
    if (reading.state === "failed") {
      console.warn("schwab trade chart read failed", reading.code);
    }
    return reading;
  } catch (error) {
    console.error("schwab trade chart read failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}
