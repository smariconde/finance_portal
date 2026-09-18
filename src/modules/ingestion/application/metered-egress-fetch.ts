import {
  admitSourceRequests,
  SourceRequestRefusedError,
  type SourceRequestVerdict,
} from "@/modules/ingestion/domain/source-budget";

import type { EgressFetch } from "./egress-fetch";
import type { SourceBudgetStore } from "./source-budget-store";

/**
 * Egress medido contra el presupuesto diario y el kill switch (ADR 0020).
 *
 * Envuelve el `EgressFetch` **por dentro** del ritmo: el espaciado y la
 * concurrencia 1 siguen gobernando el orden, y justo antes de abrir la conexión
 * esta capa gasta una unidad de cuota del día. Si no la hay, tira
 * `SourceRequestRefusedError` con su código y no se abre ningún socket.
 *
 * Es la única forma de conseguir un `EgressFetch` fuera de `src/server/egress/`,
 * y ESLint lo sostiene: un llamador que pudiera construir el cliente crudo
 * tendría una puerta sin contador.
 */
export function createMeteredEgressFetch(
  fetch: EgressFetch,
  dependencies: {
    readonly store: SourceBudgetStore;
    /** Reloj inyectado: esta capa no lee `Date.now()`. */
    readonly now: () => string;
    readonly onVerdict?: (verdict: SourceRequestVerdict) => void;
  },
): EgressFetch {
  return async (request) => {
    const verdict = await dependencies.store.consume(
      request.sourceId,
      dependencies.now(),
    );

    dependencies.onVerdict?.(verdict);

    if (verdict.status !== "allowed") {
      throw new SourceRequestRefusedError(request.sourceId, verdict);
    }

    return fetch(request);
  };
}

/**
 * Comprueba el control y el presupuesto antes de empezar, para que un comando
 * salga con el motivo en vez de fallar contra la primera llamada. No reserva
 * nada: la decisión real es la de `consume`.
 */
export async function checkSourceBudget(
  store: SourceBudgetStore,
  sourceId: string,
  requests: number,
  now: string,
): Promise<SourceRequestVerdict> {
  return admitSourceRequests(
    await store.readState(sourceId, now),
    requests,
    now,
  );
}
