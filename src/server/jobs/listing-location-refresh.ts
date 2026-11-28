import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { createPacedEgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { observeSourceSignals } from "@/modules/ingestion/application/source-signals";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveLocationSources } from "@/modules/real-estate/application/live-location-sources";
import {
  createLocationAdmission,
  createLocationExecutor,
  createLocationRecorder,
  ensureLocationRefresh,
  LOCATION_REFRESH_DATASETS,
  LOCATION_REQUEST_PACING,
  openLocationJobsInOrder,
  resolveStaleLocations,
  type LocationRefreshStatus,
} from "@/modules/real-estate/application/listing-location-refresh";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getLocationStore } from "@/server/persistence/get-location-store";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Raíz de composición de la ubicación al abrir `/inmuebles` (`F13-06`). La
 * alcanza sólo la Server Action, que ya resolvió el modo; los getters de
 * persistencia tiran `RuntimeLockedError` en un runtime trabado igual
 * (`TM-04`). Un proceso corre a lo sumo un worker; entre procesos decide el
 * lease de cada fuente (ADR 0015), y un proceso que muere deja el cursor.
 */
let activeWorker: Promise<void> | null = null;

const now = () => new Date().toISOString();

export async function ensureLocationRefreshForRequest(input: {
  readonly retryFailures: boolean;
}): Promise<{ status: LocationRefreshStatus; runWorker: boolean }> {
  return ensureLocationRefresh(input, {
    jobs: getIngestionJobStore(),
    store: getLocationStore(),
    budgets: getSourceBudgetStore(),
    now,
    workerActive: () => activeWorker !== null,
  });
}

/** Arranca el worker si este proceso no tiene uno. No lo espera. */
export function startLocationRefreshWorker(): Promise<void> {
  if (activeWorker !== null) return activeWorker;
  activeWorker = runLocationRefresh()
    .catch((error: unknown) => {
      // Sólo el tipo: el mensaje puede traer un host, un puerto o SQL (`TM-02`).
      console.error(
        "location refresh worker failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeWorker = null;
    });
  return activeWorker;
}

/**
 * Los jobs en orden —barrios, capa 8256, Georef, parcelas—, de a uno, porque
 * los puntos dependen de lo que respondió Georef. Al final resuelve en código
 * las lecturas atrasadas; si Georef destapó puntos nuevos, la próxima visita
 * los planea.
 */
export async function runLocationRefresh(): Promise<void> {
  const jobs = getIngestionJobStore();
  const store = getLocationStore();
  const registry = getSourceRegistryRepository();
  const budgets = getSourceBudgetStore();
  const sourceIds = new Set<string>(
    LOCATION_REFRESH_DATASETS.map((dataset) => dataset.sourceId),
  );
  await syncDeclaredSourceRegistry(
    DEMO_SOURCE_REGISTRY.filter((entry) => sourceIds.has(entry.sourceId)),
    registry,
  );
  const holder = `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;

  for (const job of await openLocationJobsInOrder(jobs)) {
    if (job.status !== "open") continue;
    // El observador va entre el ritmo y el medidor: una negativa del tope
    // diario no es una señal de la fuente (ADR 0020).
    const signals = observeSourceSignals(getMeteredEgressFetch());
    const fetch = createPacedEgressFetch(
      signals.fetch,
      LOCATION_REQUEST_PACING,
      {
        elapsedMs: () => performance.now(),
        sleep: (ms) => sleep(ms),
      },
    );
    const sources = createLiveLocationSources({
      sourceRegistry: registry,
      fetch,
    });
    await runIngestionJob(
      { jobId: job.jobId, holder },
      {
        store: jobs,
        execute: createLocationExecutor({
          record: createLocationRecorder({
            store,
            sources,
            now,
            newId: () => randomUUID(),
          }),
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
        admitItem: createLocationAdmission({
          sourceId: job.sourceId,
          budgets,
          now,
        }),
      },
    );
  }

  await resolveStaleLocations({ store, now });
}
