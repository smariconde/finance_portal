"use server";

import { after } from "next/server";
import { z } from "zod";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  valuationTickerSchema,
  type ValuationJobView,
} from "@/modules/valuation/domain/valuation-job";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import type { ValuationHistoryView } from "@/modules/valuation/application/read-valuation-history";
import {
  readValuationHistoryForRequest,
  requestValuationForRequest,
  startValuationWorker,
} from "@/server/jobs/valuation-job";

const valuationRequestSchema = z
  .object({
    ticker: z.string().trim().min(1).max(32),
    intent: z.enum(["enqueue", "status"]),
  })
  .strict();

export type ValuationEnqueueResult = ValuationJobView;

/**
 * Encola o consulta la corrida de un ticker (`F6-01`,
 * [ADR 0045](../../../docs/architecture/adr/0045-ticker-valuation-job.md)).
 *
 * Se trata como un endpoint público (`TM-03`):
 *
 * - el modo se resuelve en el request y un runtime trabado no abre la base;
 * - la entrada es un símbolo y la intención de encolar o consultar, nunca una
 *   URL, un CIK o una fecha;
 * - consultar no crea un job; encolar devuelve el abierto si ya hay uno;
 * - no hay egress. La respuesta son códigos.
 *
 * Next.js ya rechaza una acción cuyo `Origin` no coincide con el host.
 */
export async function enqueueValuation(
  input: unknown,
): Promise<ValuationEnqueueResult> {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return { state: "unavailable" };
  }

  const request = valuationRequestSchema.safeParse(input);
  const ticker = request.success
    ? valuationTickerSchema.safeParse(request.data.ticker)
    : null;

  if (!request.success || ticker === null || !ticker.success) {
    return { state: "unavailable" };
  }

  try {
    const result = await requestValuationForRequest({
      ticker: ticker.data,
      intent: request.data.intent,
    });

    if (result.runJobId !== null) {
      after(() => startValuationWorker(result.runJobId!));
    }

    return result.view;
  } catch (error) {
    console.error(
      "valuation enqueue failed",
      error instanceof Error ? error.name : typeof error,
    );

    return { state: "unavailable" };
  }
}

const valuationHistorySchema = z
  .object({ ticker: z.string().trim().min(1).max(32) })
  .strict();

/**
 * Historial de corridas de un ticker (`F6-02`,
 * [ADR 0047](../../../docs/architecture/adr/0047-valuation-run-history.md)).
 *
 * Mismos controles que `enqueueValuation` (`TM-03`): modo resuelto en el
 * request, esquema cerrado —un símbolo y nada más—, lectura acotada y
 * respuesta de códigos y fechas. No crea jobs, no escribe y no sale a la red.
 */
export async function loadValuationHistory(
  input: unknown,
): Promise<ValuationHistoryView> {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return { state: "unavailable" };
  }

  const request = valuationHistorySchema.safeParse(input);
  const ticker = request.success
    ? valuationTickerSchema.safeParse(request.data.ticker)
    : null;

  if (!request.success || ticker === null || !ticker.success) {
    return { state: "unavailable" };
  }

  try {
    return await readValuationHistoryForRequest(ticker.data);
  } catch (error) {
    console.error(
      "valuation history failed",
      error instanceof Error ? error.name : typeof error,
    );

    return { state: "unavailable" };
  }
}
