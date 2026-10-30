import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import type { SectorFiscalReading } from "@/modules/divergences/application/load-sector-fiscal-endpoints";
import {
  ensureSectorDivergenceDownload,
  readSectorDivergenceDownload,
  type EnsureSectorDivergenceDownloadResult,
  type SectorDivergenceDownloadDependencies,
  type SectorDivergenceDownloadStatus,
} from "@/modules/divergences/application/sector-divergence-download";
import {
  assertCompanyFactsJob,
  createCompanyFactsAdmission,
  createCompanyFactsJobExecutor,
  observeSourceSignals,
} from "@/modules/fundamentals/application/company-facts-backfill";
import { ingestCompanyFacts } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  createLiveCompanyFactsSource,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import {
  INGESTION_JOB_POLICY,
  type IngestionJobPolicy,
} from "@/modules/ingestion/domain/ingestion-job";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { loadStoredSectorFiscalEndpoints } from "@/server/divergences/load-sector-fiscal-endpoints";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

import {
  priceRefreshWorkerActive,
  startPriceRefreshWorker,
} from "./sector-price-refresh";

/**
 * Raíz de composición de la descarga de la matriz de divergencias (`F8-02`,
 * [ADR 0064](../../../docs/architecture/adr/0064-sector-divergence-download.md)).
 *
 * Sólo se alcanza desde la Server Action, que ya verificó el modo, y desde el
 * render, que sólo lee. Los precios corren con el worker de la matriz de riesgo
 * (un job de precios por proceso, cualquiera sea la matriz); la SEC tiene el
 * suyo. Entre procesos decide el lease de cada fuente (ADR 0015), y si el
 * proceso muere el próximo pedido del owner retoma el job.
 */
let activeSecWorker: Promise<void> | null = null;

/** Ninguna espera en línea pasa del minuto: más es un pendiente que se retoma. */
const SECTOR_DOWNLOAD_POLICY: IngestionJobPolicy = Object.freeze({
  ...INGESTION_JOB_POLICY,
  maxInlineWaitMs: 60_000,
});

const now = () => new Date().toISOString();

function dependencies(): SectorDivergenceDownloadDependencies {
  const corporateActions = getCorporateActionRepository();

  return {
    universe: getUniverseRepository(),
    classifications: getClassificationRepository(),
    listRelationships: () => corporateActions.listRelationships(),
    ingestionRuns: getIngestionRunRepository(),
    jobs: getIngestionJobStore(),
    budgets: getSourceBudgetStore(),
    readFiscal: (sectorCode) => loadStoredSectorFiscalEndpoints(sectorCode),
    now,
    workerActive: (source) =>
      source === SEC_SOURCE_ID
        ? activeSecWorker !== null
        : priceRefreshWorkerActive(),
  };
}

export function ensureSectorDivergenceDownloadForRequest(input: {
  readonly sectorCode: string;
  readonly retryFailures: boolean;
}): Promise<EnsureSectorDivergenceDownloadResult> {
  return ensureSectorDivergenceDownload(input, dependencies());
}

export function readSectorDivergenceDownloadForPage(input: {
  readonly sectorCode: string;
  readonly reading: SectorFiscalReading;
}): Promise<SectorDivergenceDownloadStatus> {
  return readSectorDivergenceDownload(input, dependencies());
}

/** Arranca el worker de la fuente si este proceso no tiene uno. No espera su fin. */
export function startSectorDivergenceWorker(
  run: NonNullable<EnsureSectorDivergenceDownloadResult["run"]>,
): Promise<void> {
  if (run.source !== SEC_SOURCE_ID) {
    return startPriceRefreshWorker(run.jobId);
  }

  if (activeSecWorker !== null) {
    return activeSecWorker;
  }

  activeSecWorker = runCompanyFactsJob(run.jobId)
    .catch((error: unknown) => {
      // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
      console.error(
        "sector fundamentals worker failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeSecWorker = null;
    });

  return activeSecWorker;
}

/** Corre un job de companyfacts bajo el lease de la SEC, como `fundamentals:backfill --job`. */
async function runCompanyFactsJob(jobId: string): Promise<void> {
  const store = getIngestionJobStore();
  const job = await store.getJob(jobId);

  if (job === null) {
    return;
  }

  assertCompanyFactsJob(job);

  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

  // El observador va entre el ritmo y el contador: una negativa del presupuesto
  // diario no es una señal de la SEC (ADR 0020).
  const signals = observeSourceSignals(getMeteredEgressFetch());
  const secFetch = createPacedEgressFetch(signals.fetch, SEC_REQUEST_PACING, {
    elapsedMs: () => performance.now(),
    sleep: (ms) => sleep(ms),
  });
  const universe = await getUniverseRepository().loadState({
    indexId: SP500_INDEX_ID,
  });
  const ingestion = {
    sourceRegistry: registry,
    ingestionRuns: getIngestionRunRepository(),
    sourceDocuments: getSourceDocumentRepository(),
    observations: getObservationRepository(),
    identity: createGraphIdentityResolver(() => universe.graph),
    source: createLiveCompanyFactsSource({ fetch: secFetch }),
    now,
    newId: () => randomUUID(),
  };
  const holder = `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;

  await runIngestionJob(
    { jobId, holder },
    {
      store,
      execute: createCompanyFactsJobExecutor({
        ingest: (cik) =>
          ingestCompanyFacts(
            { cik, mode: "personal", dryRun: false },
            ingestion,
          ),
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
      admitItem: createCompanyFactsAdmission({
        fetch: secFetch,
        pacing: SEC_REQUEST_PACING,
        budgets: getSourceBudgetStore(),
        now,
      }),
      policy: SECTOR_DOWNLOAD_POLICY,
    },
  );
}
