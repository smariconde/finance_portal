import "server-only";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { createMeteredEgressFetch } from "@/modules/ingestion/application/metered-egress-fetch";
import { getTradingSourceBudgetStore } from "@/server/persistence/trading/get-trading-source-budget-store";

import { getEgressClient } from "./get-egress-client";

/**
 * Egress medido de las fuentes de Schwab (ADR 0076). La misma puerta que el
 * resto, pero el presupuesto diario y el kill switch se leen de la base de
 * trading: si la base de análisis no responde, la cuenta sigue hablando con
 * Schwab. Sólo admite fuentes `schwab-*`; cualquier otra se niega antes de
 * gastar cuota en una base que no es la suya.
 */
export function getTradingEgressFetch(
  now: () => string = () => new Date().toISOString(),
): EgressFetch {
  const egress = getEgressClient();
  const metered = createMeteredEgressFetch(
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
    { store: getTradingSourceBudgetStore(), now },
  );

  return async (request) => {
    if (!request.sourceId.startsWith("schwab-")) {
      throw new Error(
        `The trading egress only meters Schwab sources, not "${request.sourceId}".`,
      );
    }
    return metered(request);
  };
}
