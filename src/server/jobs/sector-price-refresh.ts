import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import {
  createPacedEgressFetch,
  PRICES_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { observeSourceSignals } from "@/modules/ingestion/application/source-signals";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { ingestBenchmark } from "@/modules/prices/application/ingest-benchmark";
import { ingestPrices } from "@/modules/prices/application/ingest-prices";
import { createLivePriceSource } from "@/modules/prices/application/live-price-source";
import {
  assertPriceRefreshJob,
  createPriceRefreshAdmission,
  createPriceRefreshJobExecutor,
  ensureSectorPrices,
  PriceSubjectUnresolvedError,
  type EnsureSectorPricesResult,
} from "@/modules/prices/application/sector-price-refresh";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Raíz de composición de la actualización de precios al abrir una matriz
 * (`F7-08`, [ADR 0030](../../../docs/architecture/adr/0030-sector-prices-on-open.md)).
 *
 * Sólo se alcanza desde la Server Action, que ya verificó el modo: los getters de
 * persistencia igual lanzan `RuntimeLockedError` en un runtime trabado, así que
 * un llamador que se saltee la guarda no consigue una base (`TM-04`).
 *
 * Un proceso corre a lo sumo un worker; entre procesos decide el lease de la
 * fuente (ADR 0015). El worker sigue aunque la pestaña se cierre, y si el
 * proceso muere el próximo que abra una matriz lo retoma.
 */
let activeWorker: Promise<void> | null = null;

const now = () => new Date().toISOString();

export async function ensureSectorPricesForRequest(input: {
  readonly sectorCode: string;
  readonly retryFailures: boolean;
}): Promise<EnsureSectorPricesResult> {
  return ensureSectorPrices(input, {
    universe: getUniverseRepository(),
    classifications: getClassificationRepository(),
    prices: getPriceRepository(),
    jobs: getIngestionJobStore(),
    budgets: getSourceBudgetStore(),
    now,
    workerActive: () => activeWorker !== null,
  });
}

/** Arranca el worker del job si este proceso no tiene uno. No espera su fin. */
export function startPriceRefreshWorker(jobId: string): Promise<void> {
  if (activeWorker !== null) {
    return activeWorker;
  }

  activeWorker = runWorker(jobId)
    .catch((error: unknown) => {
      // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
      console.error(
        "price refresh worker failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeWorker = null;
    });

  return activeWorker;
}

async function runWorker(jobId: string): Promise<void> {
  const store = getIngestionJobStore();
  const job = await store.getJob(jobId);

  if (job === null) {
    return;
  }

  assertPriceRefreshJob(job);

  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

  // El observador va entre el ritmo y el contador: una negativa del presupuesto
  // diario no es una señal de la fuente (ADR 0020).
  const signals = observeSourceSignals(getMeteredEgressFetch());
  const jobFetch = createPacedEgressFetch(
    signals.fetch,
    PRICES_REQUEST_PACING,
    {
      elapsedMs: () => performance.now(),
      sleep: (ms) => sleep(ms),
    },
  );
  const source = createLivePriceSource({
    sourceRegistry: registry,
    fetch: jobFetch,
    now: () => new Date(),
  });
  const prices = getPriceRepository();
  const ingestionRuns = getIngestionRunRepository();
  const shared = {
    source,
    repository: prices,
    ingestionRuns,
    now,
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };

  // El grafo se lee una vez por corrida: el ticker vigente de cada security es
  // lo que se le pide a la fuente.
  const state = await getUniverseRepository().loadState({
    indexId: SP500_INDEX_ID,
  });

  const holder = `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;

  await runIngestionJob(
    { jobId, holder },
    {
      store,
      execute: createPriceRefreshJobExecutor({
        ingestSecurity: async (securityId) => {
          const at = now();
          const cutoff = pointInTimeQuerySchema.parse({
            effectiveAt: at,
            revisionPolicy: "as_known",
            knownAt: at,
            sourcePolicyVersion: "source-policy-1.0.0",
          });
          const [ticker] = securityTickersAt(state.graph, securityId, cutoff);

          if (ticker === undefined) {
            throw new PriceSubjectUnresolvedError(securityId);
          }

          const outcome = await ingestPrices(
            { securityId, symbol: ticker.symbol },
            shared,
          );

          return outcome.runId!;
        },
        ingestBenchmark: async (benchmarkId) =>
          (await ingestBenchmark(benchmarkId, shared)).runId!,
        takeSignal: signals.take,
      }),
      now,
      sleep: (ms) => sleep(ms),
      newLeaseToken: () => randomUUID(),
      startHeartbeat: (beat, intervalMs) => {
        const timer = setInterval(() => void beat(), intervalMs);
        timer.unref();
        return () => clearInterval(timer);
      },
      admitItem: createPriceRefreshAdmission({
        fetch: jobFetch,
        pacing: PRICES_REQUEST_PACING,
        budgets: getSourceBudgetStore(),
        now,
      }),
    },
  );
}
