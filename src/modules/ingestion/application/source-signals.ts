import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import type { SourceSignalKind } from "@/modules/ingestion/domain/ingestion-job";

import type { EgressFetch } from "./egress-fetch";

/**
 * Señales de la fuente para un job durable (ADR 0015).
 *
 * Mudado desde el backfill de la SEC cuando el job de precios (`F7-08`) lo
 * necesitó: qué respuesta es la fuente frenando al cliente no depende de qué
 * documento se pidió.
 */
export type SourceSignal = {
  readonly kind: SourceSignalKind;
  readonly status: number | null;
  readonly retryAfter: string | null;
  readonly detail: string;
};

/**
 * Egress que falla por la red o por la fuente y no por el documento pedido.
 * `response_too_large` queda afuera: es un filer con un documento enorme, no una
 * fuente caída.
 */
const UNAVAILABLE_EGRESS_CODES: ReadonlySet<string> = new Set([
  "address_unresolvable",
  "deadline_exceeded",
  "transport_error",
]);
const DOCUMENT_EGRESS_CODES: ReadonlySet<string> = new Set([
  "response_too_large",
]);

function egressCode(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : null;
}

/**
 * Observa el egress de la SEC y recuerda la primera señal de la fuente desde la
 * última lectura.
 *
 * - `429` → `throttled`;
 * - `403` → `refused`: en `data.sec.gov` un filer inexistente es `404`, así que un
 *   `403` es la fuente rechazando al cliente —User-Agent o ritmo—, no al filer;
 * - `503`, red caída o sin respuesta → `unavailable`;
 * - cualquier otro bloqueo del egress —allowlist, dirección privada, redirect—
 *   es configuración o una fuente que dejó de ser la aprobada → `refused`.
 *
 * Va **debajo** del espaciador: un presupuesto agotado no es una señal de la
 * fuente, y la reserva por empresa impide que ocurra a mitad de una carga. Por lo
 * mismo ignora la negativa del presupuesto diario y del kill switch (ADR 0020):
 * esa es una decisión nuestra, no algo que la fuente haya dicho.
 */
export function observeSourceSignals(fetch: EgressFetch): {
  readonly fetch: EgressFetch;
  readonly take: () => SourceSignal | null;
} {
  let signal: SourceSignal | null = null;
  const record = (next: SourceSignal) => {
    signal ??= next;
  };

  return {
    fetch: async (request) => {
      let response;

      try {
        response = await fetch(request);
      } catch (cause) {
        if (cause instanceof SourceRequestRefusedError) {
          throw cause;
        }

        const code = egressCode(cause);

        if (code === null || UNAVAILABLE_EGRESS_CODES.has(code)) {
          record({
            kind: "unavailable",
            status: null,
            retryAfter: null,
            detail: code ?? "egress failed",
          });
        } else if (!DOCUMENT_EGRESS_CODES.has(code)) {
          record({
            kind: "refused",
            status: null,
            retryAfter: null,
            detail: code,
          });
        }

        throw cause;
      }

      const kind: SourceSignalKind | null =
        response.status === 429
          ? "throttled"
          : response.status === 403
            ? "refused"
            : response.status === 503
              ? "unavailable"
              : null;

      if (kind !== null) {
        record({
          kind,
          status: response.status,
          retryAfter: response.retryAfter ?? null,
          detail: `status ${response.status}`,
        });
      }

      return response;
    },
    take: () => {
      const taken = signal;
      signal = null;
      return taken;
    },
  };
}
