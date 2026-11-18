"use server";

import { after } from "next/server";
import { z } from "zod";

import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  valuationTickerSchema,
  type ValuationJobView,
} from "@/modules/valuation/domain/valuation-job";
import type { ConsensusRefreshStatus } from "@/modules/consensus/application/consensus-refresh";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  declareForwardPeThresholdForRequest,
  ensureConsensusForRequest,
  startConsensusWorker,
  subjectOfValuedTicker,
} from "@/server/jobs/consensus-refresh";
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

const consensusRequestSchema = z
  .object({
    ticker: z.string().trim().min(1).max(32),
    retryFailures: z.boolean(),
  })
  .strict();

export type ConsensusRefreshResult =
  | ConsensusRefreshStatus
  /** Locked runtime, invalid request, unvalued ticker or a database down. */
  | { readonly state: "unavailable" };

/**
 * Brings a valued company's analyst consensus up to date on opening its
 * valuation (`F6-29`,
 * [ADR 0083](../../../docs/architecture/adr/0083-consensus-estimates-forward-pe.md)).
 *
 * A public endpoint in all but name (`TM-03`): the mode is resolved in the
 * request; the input is a symbol and a boolean under a closed schema, never a
 * URL; only a ticker with a recorded valuation run is captured, so a request
 * cannot choose what is downloaded; the request itself opens no network —the
 * worker after it does, through the metered door under the source's lease,
 * budget and kill switch (ADR 0020)—; the answer is a state and codes.
 */
export async function refreshConsensus(
  input: unknown,
): Promise<ConsensusRefreshResult> {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) return { state: "unavailable" };

  const request = consensusRequestSchema.safeParse(input);
  const ticker = request.success
    ? valuationTickerSchema.safeParse(request.data.ticker)
    : null;
  if (!request.success || ticker === null || !ticker.success) {
    return { state: "unavailable" };
  }

  try {
    const subject = await subjectOfValuedTicker(ticker.data);
    if (subject === null) return { state: "unavailable" };
    const result = await ensureConsensusForRequest({
      securityId: subject.securityId,
      retryFailures: request.data.retryFailures,
    });
    if (result.runJobId !== null) {
      const jobId = result.runJobId;
      after(() => startConsensusWorker(jobId));
    }
    return result.status;
  } catch (error) {
    // Only the type: a message can carry a host, a port or SQL (`TM-02`).
    console.error(
      "consensus refresh failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { state: "unavailable" };
  }
}

const thresholdRequestSchema = z
  .object({
    ticker: z.string().trim().min(1).max(32),
    /** `null` removes it; otherwise a multiple with up to two decimals. */
    value: z
      .string()
      .trim()
      .regex(/^(?:[1-9]\d{0,2})(?:[.,]\d{1,2})?$/u)
      .nullable(),
  })
  .strict();

export type ForwardPeThresholdResult =
  { readonly state: "saved" } | { readonly state: "unavailable" };

/**
 * The owner's forward P/E threshold for a valued company (`F6-29`, ADR 0083):
 * an append-only revision, drawn as a line and never a buy label. Same guards
 * as the other actions (`TM-03`): mode in the request, a closed schema with a
 * bounded number, a ticker that must have a recorded run, no network.
 */
export async function declareForwardPeThreshold(
  input: unknown,
): Promise<ForwardPeThresholdResult> {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) return { state: "unavailable" };

  const request = thresholdRequestSchema.safeParse(input);
  const ticker = request.success
    ? valuationTickerSchema.safeParse(request.data.ticker)
    : null;
  if (!request.success || ticker === null || !ticker.success) {
    return { state: "unavailable" };
  }
  const value =
    request.data.value === null ? null : request.data.value.replace(",", ".");
  if (value !== null && (Number(value) <= 0 || Number(value) > 1000)) {
    return { state: "unavailable" };
  }

  try {
    const subject = await subjectOfValuedTicker(ticker.data);
    if (subject === null) return { state: "unavailable" };
    await declareForwardPeThresholdForRequest({
      legalEntityId: subject.legalEntityId,
      value,
    });
    return { state: "saved" };
  } catch (error) {
    console.error(
      "forward P/E threshold failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { state: "unavailable" };
  }
}
