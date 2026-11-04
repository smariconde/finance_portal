import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ARGENTINA_REFRESH_SOURCES,
  argentinaRefreshAdmissionBlock,
  assertArgentinaRefreshJob,
  createArgentinaRefreshAdmission,
  createArgentinaRefreshExecutor,
  ensureArgentinaRefresh,
  openRefreshJobs,
  readArgentinaRefreshReadiness,
  runIndependentRefreshJobs,
  RefreshSubjectRejectedError,
  type ArgentinaRefreshReadiness,
  type EnsureArgentinaRefreshResult,
  type RefreshSource,
  type RefreshSourceId,
} from "@/modules/argentina-dashboard/application/argentina-refresh";
import {
  ADR_PAIR_HISTORY_FROM,
  ingestAdrLeg,
} from "@/modules/implied-fx/application/ingest-adr-pair-legs";
import {
  ARGENTINA_SERIES_REQUEST_PACING,
  BCRA_REQUEST_PACING,
  createPacedEgressFetch,
  INDEC_REQUEST_PACING,
  PRICES_REQUEST_PACING,
  SOY_REQUEST_PACING,
  type RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { observeSourceSignals } from "@/modules/ingestion/application/source-signals";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import type { IngestionJob } from "@/modules/ingestion/domain/ingestion-job";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveArgentinaSeriesSource } from "@/modules/macro-series/application/live-argentina-series-source";
import { createLiveBcraSource } from "@/modules/macro-series/application/live-bcra-source";
import { createLiveIndecSource } from "@/modules/macro-series/application/live-indec-source";
import {
  createLiveBnaSource,
  createLiveCacPizarraSource,
  createLiveMagypSource,
  createLiveYahooFuturesSource,
} from "@/modules/macro-series/application/live-soy-sources";
import { recordArgentinaIndicator } from "@/modules/macro-series/application/record-argentina-indicator";
import { recordBcraSeries } from "@/modules/macro-series/application/record-bcra-series";
import { declaredArgentinaIndicator } from "@/modules/macro-series/domain/declared-argentina-indicators";
import { declaredSoyIndicator } from "@/modules/macro-series/domain/declared-soy-indicators";
import { createLivePriceSource } from "@/modules/prices/application/live-price-source";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { credentialProblem } from "@/server/egress/fetch-approved-resource";
import { getAdrPairRepository } from "@/server/persistence/get-adr-pair-repository";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Composition root of the refresh of `/argentina` on open (`F9-12`,
 * [ADR 0070](../../../docs/architecture/adr/0070-argentina-refresh-on-open.md)).
 *
 * Reached only from the Server Action, which already checked the mode; the
 * persistence getters throw `RuntimeLockedError` in a locked runtime anyway
 * (`TM-04`). A process runs at most one worker; between processes each
 * source's lease decides (ADR 0015). If the process dies, the next visit
 * resumes from the cursor.
 */
let activeWorker: Promise<void> | null = null;

const now = () => new Date().toISOString();

function dependencies() {
  return {
    jobs: getIngestionJobStore(),
    ingestionRuns: getIngestionRunRepository(),
    budgets: getSourceBudgetStore(),
    now,
    credentialProblem: (sourceId: RefreshSourceId) =>
      sourceId === "indec-api"
        ? credentialProblem(process.env.INDEC_API_TOKEN)
        : null,
  };
}

export async function readArgentinaRefreshReadinessForRender(): Promise<ArgentinaRefreshReadiness> {
  return readArgentinaRefreshReadiness(dependencies());
}

export async function ensureArgentinaRefreshForRequest(input: {
  readonly retryFailures: boolean;
}): Promise<EnsureArgentinaRefreshResult> {
  return ensureArgentinaRefresh(input, {
    ...dependencies(),
    workerActive: () => activeWorker !== null,
  });
}

/** Starts the worker if this process has none. Does not wait for it. */
export function startArgentinaRefreshWorker(): Promise<void> {
  if (activeWorker !== null) return activeWorker;
  activeWorker = runOpenJobs()
    .catch((error: unknown) => {
      // Only the type: the message may carry a host, a port or SQL (`TM-02`).
      console.error(
        "argentina refresh worker failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeWorker = null;
    });
  return activeWorker;
}

const PACING: Readonly<Record<RefreshSourceId, RequestPacingPolicy>> = {
  "bcra-monetarias-v4": BCRA_REQUEST_PACING,
  "yahoo-finance": PRICES_REQUEST_PACING,
  "indec-api": INDEC_REQUEST_PACING,
  "argentina-series-tiempo": ARGENTINA_SERIES_REQUEST_PACING,
  "bcr-cac-pizarra": SOY_REQUEST_PACING,
  "bna-fx": SOY_REQUEST_PACING,
  "magyp-estimaciones": SOY_REQUEST_PACING,
};

/** Independent sources advance together; each keeps its own lease and pace. */
async function runOpenJobs(): Promise<void> {
  const store = getIngestionJobStore();
  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);
  const holder = `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;

  // The oldest first, in the declared order of the sources.
  const available = await Promise.all(
    (await openRefreshJobs(store)).map(async (job) => {
      if (job.status !== "open") return null;
      const source = assertArgentinaRefreshJob(job);
      if (dependencies().credentialProblem(source.sourceId) !== null) {
        return null;
      }
      const blocked = await argentinaRefreshAdmissionBlock(
        getSourceBudgetStore(),
        source,
        now(),
      );
      return blocked === null ? job : null;
    }),
  );
  const open = available
    .filter((job): job is IngestionJob => job !== null)
    .sort(
      (left, right) =>
        ARGENTINA_REFRESH_SOURCES.findIndex(
          (source) => source.sourceId === left.sourceId,
        ) -
        ARGENTINA_REFRESH_SOURCES.findIndex(
          (source) => source.sourceId === right.sourceId,
        ),
    );

  await runIndependentRefreshJobs(open, async (job) => {
    const source = assertArgentinaRefreshJob(job);
    // The observer sits between the pacing and the meter: a refusal of the
    // daily budget is not a signal from the source (ADR 0020).
    const signals = observeSourceSignals(getMeteredEgressFetch());
    const pacing = PACING[source.sourceId];
    const jobFetch = createPacedEgressFetch(signals.fetch, pacing, {
      elapsedMs: () => performance.now(),
      sleep: (ms) => sleep(ms),
    });

    await runIngestionJob(
      { jobId: job.jobId, holder },
      {
        store,
        execute: createArgentinaRefreshExecutor({
          record: recorderFor(source, jobFetch, registry),
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
        admitItem: createArgentinaRefreshAdmission({
          source,
          fetch: jobFetch,
          pacing,
          budgets: getSourceBudgetStore(),
          now,
        }),
      },
    );
  });
}

type Recorder = (job: IngestionJob, subjectKey: string) => Promise<string>;

function recorderFor(
  source: RefreshSource,
  fetch: ReturnType<typeof createPacedEgressFetch>,
  registry: ReturnType<typeof getSourceRegistryRepository>,
): Recorder {
  const ingestionRuns = getIngestionRunRepository();
  const newId = () => randomUUID();
  const soyAdapters = {
    sourceRegistry: registry,
    fetch,
    now: () => new Date(),
  };

  /** A declared soy series recorded through the given adapter (ADR 0071). */
  function soyRecorder(
    adapter: ReturnType<typeof createLiveCacPizarraSource>,
  ): Recorder {
    return async (_job, subjectKey) => {
      const indicator = declaredSoyIndicator(subjectKey);
      if (indicator === null || indicator.sourceId !== adapter.sourceId) {
        throw new RefreshSubjectRejectedError("not_declared");
      }
      const outcome = await recordArgentinaIndicator(indicator, {
        sources: [adapter],
        repository: getArgentinaIndicatorRepository(),
        ingestionRuns,
        now,
        newId,
      });
      if (outcome.runId === null) {
        throw new RefreshSubjectRejectedError("indicator_not_recorded");
      }
      return outcome.runId;
    };
  }

  switch (source.sourceId) {
    case "bcra-monetarias-v4": {
      const bcra = createLiveBcraSource({ sourceRegistry: registry, fetch });
      return async (_job, subjectKey) => {
        const outcome = await recordBcraSeries(Number(subjectKey), {
          source: bcra,
          repository: getMacroSeriesRepository(),
          ingestionRuns,
          now,
          newId,
        });
        if (outcome.status !== "recorded" || outcome.runId === null) {
          throw new RefreshSubjectRejectedError(outcome.status);
        }
        return outcome.runId;
      };
    }
    case "yahoo-finance": {
      const prices = createLivePriceSource({
        sourceRegistry: registry,
        fetch,
        now: () => new Date(),
        historyFrom: ADR_PAIR_HISTORY_FROM,
      });
      const futures = soyRecorder(createLiveYahooFuturesSource(soyAdapters));
      return async (job, subjectKey) => {
        if (declaredSoyIndicator(subjectKey) !== null) {
          return futures(job, subjectKey);
        }
        const side = subjectKey.endsWith("-adr") ? "adr" : "local";
        const pairId = subjectKey.slice(0, subjectKey.lastIndexOf("-"));
        const outcome = await ingestAdrLeg(pairId, side, {
          source: prices,
          repository: getAdrPairRepository(),
          ingestionRuns,
          now,
          newId,
          hashContent: (input: string) =>
            createHash("sha256").update(input).digest("hex"),
        });
        if (outcome.runId === null) {
          throw new RefreshSubjectRejectedError("leg_not_recorded");
        }
        return outcome.runId;
      };
    }
    case "indec-api":
    case "argentina-series-tiempo": {
      const adapter =
        source.sourceId === "indec-api"
          ? createLiveIndecSource({ sourceRegistry: registry, fetch })
          : createLiveArgentinaSeriesSource({
              sourceRegistry: registry,
              fetch,
            });
      return async (_job, subjectKey) => {
        const indicator = declaredArgentinaIndicator(subjectKey);
        if (indicator === null) {
          throw new RefreshSubjectRejectedError("not_declared");
        }
        const outcome = await recordArgentinaIndicator(indicator, {
          sources: [adapter],
          repository: getArgentinaIndicatorRepository(),
          ingestionRuns,
          now,
          newId,
        });
        if (outcome.runId === null) {
          throw new RefreshSubjectRejectedError("indicator_not_recorded");
        }
        return outcome.runId;
      };
    }
    case "bcr-cac-pizarra":
      return soyRecorder(createLiveCacPizarraSource(soyAdapters));
    case "bna-fx":
      return soyRecorder(createLiveBnaSource(soyAdapters));
    case "magyp-estimaciones":
      // One adapter for the job: its four series share one download.
      return soyRecorder(createLiveMagypSource(soyAdapters));
  }
}
