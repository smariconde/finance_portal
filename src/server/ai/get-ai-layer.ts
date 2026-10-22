import "server-only";

import { randomUUID } from "node:crypto";

import type { AiSpendStore } from "@/modules/ai/application/ai-spend-store";
import type { RunModelLadderDependencies } from "@/modules/ai/application/run-model-ladder";
import { createProviderBreaker } from "@/modules/ai/domain/provider-breaker";
import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type { RequestPacingPolicy } from "@/modules/ingestion/application/egress-fetch";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getAiSpendStore } from "@/server/persistence/get-ai-spend-store";

/**
 * Raíz de composición de la capa IA (`F5-02`,
 * [ADR 0033](../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md)).
 *
 * Es la única forma de conseguir lo que una tarea necesita para llamar a un
 * modelo, y la negativa llega primero: en un runtime trabado no se construye
 * el egress, no se abre PostgreSQL y no se lee ninguna clave (`TM-01`). La clave
 * tampoco pasa por acá: la agrega la puerta de salida.
 *
 * `src/app/` no puede importarla —ESLint lo sostiene—. Desde `F6-13`
 * ([ADR 0052](../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md))
 * la toma el worker de la corrida por ticker, después de que la acción
 * respondió: la acción no la importa ni ve su gasto. Otra superficie que llegue
 * a un modelo es una frontera nueva con su propio slice y `TM-03` cerrado.
 */

/**
 * Ritmo de una corrida: una llamada por segundo, de a una, y un techo de
 * proceso igual al tope diario de la fuente. El gasto en dólares suele frenar
 * antes.
 */
export const OPENROUTER_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: 100,
});

export type AiLayer = {
  readonly spend: AiSpendStore;
  /**
   * Dependencias de **una** corrida: ritmo, techo de proceso y breaker propios.
   * Dos corridas no comparten breaker, igual que no comparten presupuesto por
   * proceso.
   */
  readonly runDependencies: (
    pacing?: RequestPacingPolicy,
  ) => RunModelLadderDependencies;
};

let layer: AiLayer | undefined;

export function getAiLayer(): AiLayer {
  if (layer) {
    return layer;
  }

  const effectiveMode = getConfigHealth(process.env).mode;

  layer = selectPersonalDependency(effectiveMode, "ai layer", () => {
    const spend = getAiSpendStore();

    return {
      spend,
      runDependencies: (pacing = OPENROUTER_REQUEST_PACING) => ({
        fetch: getSourceEgressFetch(pacing),
        spend,
        breaker: createProviderBreaker(),
        now: () => new Date().toISOString(),
        elapsedMs: () => performance.now(),
        newId: () => randomUUID(),
      }),
    };
  });

  return layer;
}
