import {
  CAPTURE_REQUEST_VERSION,
  MAX_CAPTURES_PER_REQUEST,
  captureResponseSchema,
  type CaptureOutcome,
} from "../../../src/modules/real-estate/domain/capture-request";
import type { ListingCapture } from "../../../src/modules/real-estate/domain/listing-capture";

import {
  CAPTURE_ENDPOINT_PATH,
  isDeclaredEndpointBase,
} from "./endpoint-origins";

/**
 * La cola local de la extensión (ADR 0089, «Envío»): lo capturado espera acá
 * hasta que el endpoint lo acepta, así un portal cerrado, sin red o con el
 * token vencido no pierde nada de lo visto. Todo es puro sobre el estado; el
 * service worker lo guarda en `chrome.storage.local`.
 */
export const CAPTURE_QUEUE_VERSION = "listing-capture-queue-1.0.0";

/** Tope de la cola: a 24 por listado, ~80 listados sin enviar. */
export const MAX_QUEUED_CAPTURES = 2000;

export type QueuedCapture = {
  readonly adapterVersion: string;
  readonly capture: ListingCapture;
};

export type CaptureSettings = {
  /** Origen del portal, p. ej. `https://finance-portal-flame.vercel.app/`. */
  readonly endpointBase: string;
  readonly captureToken: string;
  /** El secreto de bypass de Vercel; vacío en local. */
  readonly vercelBypass: string;
};

/** Por qué no se pudo enviar; un código cerrado que muestra el popup. */
export type SendFailure =
  | "not_configured"
  | "unauthorized"
  | "not_served"
  | "budget_exhausted"
  | "server_unavailable"
  | "network_error"
  | "response_invalid";

export type QueueState = {
  readonly items: readonly QueuedCapture[];
  /** Cuántas capturas se descartaron por la cola llena, desde siempre. */
  readonly dropped: number;
};

export const EMPTY_QUEUE: QueueState = { items: [], dropped: 0 };

const keyOf = (item: QueuedCapture) =>
  `${item.capture.source}\u0000${item.capture.externalId}\u0000${item.capture.pageKind}`;

/**
 * Encola lo que salió de una página. Una misma ficha vista dos veces antes de
 * enviar queda una sola vez, la última; el servidor igual ordena por
 * `capturedAt`. Si la cola se llena, se descarta **lo más viejo** y se cuenta:
 * lo último que el owner vio es lo que más vale.
 */
export function enqueue(
  state: QueueState,
  incoming: readonly QueuedCapture[],
): QueueState {
  const incomingKeys = new Set(incoming.map(keyOf));
  const kept = state.items.filter((item) => !incomingKeys.has(keyOf(item)));
  const merged = [...kept, ...incoming];
  const overflow = Math.max(0, merged.length - MAX_QUEUED_CAPTURES);
  return {
    items: merged.slice(overflow),
    dropped: state.dropped + overflow,
  };
}

/** El próximo lote: hasta 50 capturas leídas por la misma versión de adapter. */
export function nextBatch(state: QueueState): readonly QueuedCapture[] {
  const first = state.items[0];
  if (first === undefined) return [];
  return state.items
    .filter((item) => item.adapterVersion === first.adapterVersion)
    .slice(0, MAX_CAPTURES_PER_REQUEST);
}

/** Saca de la cola un lote ya resuelto (aceptado o rechazado por contenido). */
export function settle(
  state: QueueState,
  batch: readonly QueuedCapture[],
): QueueState {
  const done = new Set(batch);
  return { ...state, items: state.items.filter((item) => !done.has(item)) };
}

export type SendResult =
  | {
      readonly kind: "settled";
      readonly outcomes: Readonly<Partial<Record<CaptureOutcome, number>>>;
    }
  /** El servidor rechazó el pedido entero por su forma: reenviarlo no sirve. */
  | { readonly kind: "batch_rejected"; readonly status: number }
  | { readonly kind: "failed"; readonly failure: SendFailure };

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Envía un lote. Nunca lanza: todo termina en un resultado con nombre. */
export async function sendBatch(
  fetchFn: Fetch,
  settings: CaptureSettings | null,
  batch: readonly QueuedCapture[],
): Promise<SendResult> {
  if (
    settings === null ||
    settings.captureToken === "" ||
    !isDeclaredEndpointBase(settings.endpointBase)
  ) {
    return { kind: "failed", failure: "not_configured" };
  }
  if (batch.length === 0) return { kind: "settled", outcomes: {} };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.captureToken}`,
    "Content-Type": "application/json",
  };
  if (settings.vercelBypass !== "")
    headers["x-vercel-protection-bypass"] = settings.vercelBypass;

  let response: Response;
  try {
    response = await fetchFn(
      new URL(CAPTURE_ENDPOINT_PATH, settings.endpointBase).toString(),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          contract: CAPTURE_REQUEST_VERSION,
          adapterVersion: batch[0].adapterVersion,
          captures: batch.map((item) => item.capture),
        }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      },
    );
  } catch {
    return { kind: "failed", failure: "network_error" };
  }

  if (response.status === 401 || response.status === 403)
    return { kind: "failed", failure: "unauthorized" };
  if (response.status === 404) return { kind: "failed", failure: "not_served" };
  if (response.status === 429)
    return { kind: "failed", failure: "budget_exhausted" };
  if (response.status >= 500)
    return { kind: "failed", failure: "server_unavailable" };
  if (
    response.status === 400 ||
    response.status === 413 ||
    response.status === 415
  )
    return { kind: "batch_rejected", status: response.status };
  if (response.status !== 200)
    return { kind: "failed", failure: "response_invalid" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "failed", failure: "response_invalid" };
  }
  const parsed = captureResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.results.length !== batch.length)
    return { kind: "failed", failure: "response_invalid" };

  const outcomes: Partial<Record<CaptureOutcome, number>> = {};
  for (const result of parsed.data.results) {
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  return { kind: "settled", outcomes };
}
