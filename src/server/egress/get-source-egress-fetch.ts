import "server-only";

import { setTimeout as sleep } from "node:timers/promises";

import {
  createPacedEgressFetch,
  type EgressFetch,
  type PacedEgressFetch,
  type RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import { createMeteredEgressFetch } from "@/modules/ingestion/application/metered-egress-fetch";
import type { SourceRequestVerdict } from "@/modules/ingestion/domain/source-budget";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";

import { getEgressClient } from "./get-egress-client";

/**
 * La única forma de conseguir un `EgressFetch` fuera de este directorio.
 *
 * Arma las tres capas en el orden en que tienen que estar:
 *
 * 1. **ritmo** por corrida (espaciado, concurrencia 1, techo del proceso);
 * 2. **presupuesto diario y kill switch** por fuente, en PostgreSQL (ADR 0020);
 * 3. el cliente de egress, que autoriza la URL contra la allowlist (ADR 0009).
 *
 * El medidor va por dentro del ritmo a propósito: primero se ordena y espacia la
 * llamada, y recién cuando le toca salir se gasta la cuota del día. Así el
 * contador cuenta llamadas que iban a salir, no intenciones encoladas.
 *
 * `getEgressClient` está restringido por ESLint a este directorio: un llamador
 * que pudiera construir el cliente crudo tendría una puerta sin contador, que es
 * exactamente lo que este incremento cierra (`TM-10`).
 */
export type SourceEgressOptions = {
  readonly now?: () => string;
  readonly onVerdict?: (verdict: SourceRequestVerdict) => void;
};

/**
 * Egress medido, sin ritmo. Lo usa quien necesita poner algo **entre** el ritmo y
 * el contador: el backfill observa ahí las señales de la SEC, que son de la
 * fuente y no de nuestro control.
 */
export function getMeteredEgressFetch(
  options: SourceEgressOptions = {},
): EgressFetch {
  const egress = getEgressClient();

  return createMeteredEgressFetch(
    (async (request) => {
      const response = await egress(request);

      return {
        status: response.status,
        body: response.body,
        byteLength: response.byteLength,
        fetchedAt: response.fetchedAt,
        retryAfter: response.retryAfter,
      };
    }) satisfies EgressFetch,
    {
      store: getSourceBudgetStore(),
      now: options.now ?? (() => new Date().toISOString()),
      onVerdict: options.onVerdict,
    },
  );
}

export function getSourceEgressFetch(
  pacing: RequestPacingPolicy,
  options: SourceEgressOptions = {},
): PacedEgressFetch {
  return createPacedEgressFetch(getMeteredEgressFetch(options), pacing, {
    elapsedMs: () => performance.now(),
    sleep: (ms) => sleep(ms),
  });
}
