"use server";

import { after } from "next/server";
import { z } from "zod";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  valuationTickerSchema,
  type ValuationJobView,
} from "@/modules/valuation/domain/valuation-job";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
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
 * - el request no sale a la red. El worker que arranca después sí
 *   (`F6-05`, ADR 0051): baja lo que falta por el egress medido, bajo el lease
 *   y la cuota de cada fuente, y nunca con un dato del request más que el
 *   ticker ya validado. La respuesta son códigos.
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
