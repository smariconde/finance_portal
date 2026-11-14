import "server-only";

import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  cedearOf,
  resolvePositionIdentity,
  sectorOf,
  valuationOf,
  type PositionContext,
} from "@/modules/trading/domain/position-context";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import type { StoredValuationRun } from "@/modules/valuation/domain/stored-valuation-run";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getValuationJobStore } from "@/server/persistence/get-valuation-job-store";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

/** Los mismos 20 trabajos que lee el historial de `/valuacion/[ticker]`. */
const VALUATION_JOBS_READ = 20;

/**
 * El cruce de las posiciones con la base de análisis (`position-context-1.0.0`).
 * Lee al corte `now` y nunca escribe ni encola: abrir la cuenta no pide una
 * valuación. Si la base de análisis falla, quien llama recibe el error y lo
 * muestra como «cruce no disponible»; la cuenta ya se leyó por su lado.
 */
export async function loadPositionContext(
  symbols: readonly string[],
  now: string,
): Promise<PositionContext[]> {
  if (symbols.length === 0) return [];

  const query = pointInTimeQuerySchema.parse({
    effectiveAt: now,
    revisionPolicy: "as_known",
    knownAt: now,
    sourcePolicyVersion: "source-policy-1.0.0",
  });

  const jobs = getValuationJobStore();
  const runs = getValuationRunRepository();

  const latestRunOf = async (
    symbol: string,
  ): Promise<{ requested: boolean; run: StoredValuationRun | null }> => {
    // `BRK/B` no es un ticker de valuación: nunca se pudo pedir con ese nombre.
    const ticker = valuationTickerSchema.safeParse(symbol);
    if (!ticker.success) return { requested: false, run: null };
    const completed = await jobs.listCompletedByTicker(
      ticker.data,
      VALUATION_JOBS_READ,
    );
    const recorded = completed.find((job) => job.valuationRunId !== null);
    return {
      requested: completed.length > 0,
      run:
        recorded === undefined
          ? null
          : await runs.findById(recorded.valuationRunId!),
    };
  };

  const [state, classifications, registry, valuations] = await Promise.all([
    getUniverseRepository().loadState({
      indexId: SP500_INDEX_ID,
      versions: "all",
      limit: 50_000,
    }),
    getClassificationRepository().loadClassifications({
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    }),
    getCedearRegistryRepository().loadRegistry({}),
    Promise.all(symbols.map(latestRunOf)),
  ]);

  return symbols.map((symbol, index) => {
    const identity = resolvePositionIdentity(state.graph, symbol, query);
    if (identity.status === "unresolved") {
      return { symbol, status: "unresolved", reason: identity.reason };
    }
    const { requested, run } = valuations[index]!;
    return {
      symbol,
      status: "resolved",
      valuation: valuationOf(run, requested),
      sector: sectorOf(classifications, identity.legalEntityId, query),
      cedear: cedearOf(registry, identity.securityId, query),
    };
  });
}
