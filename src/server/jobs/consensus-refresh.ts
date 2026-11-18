import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import {
  assertConsensusRefreshJob,
  ConsensusSubjectUnresolvedError,
  createConsensusRefreshAdmission,
  createConsensusRefreshJobExecutor,
  ensureConsensus,
  readConsensusReadiness,
  type EnsureConsensusResult,
} from "@/modules/consensus/application/consensus-refresh";
import { createLiveConsensusSource } from "@/modules/consensus/application/live-consensus-source";
import {
  loadForwardMultiples,
  type ForwardMultiplesView,
} from "@/modules/consensus/application/load-forward-multiples";
import { recordConsensus } from "@/modules/consensus/application/record-consensus";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import {
  CONSENSUS_REQUEST_PACING,
  createPacedEgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { observeSourceSignals } from "@/modules/ingestion/application/source-signals";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { credentialProblem } from "@/server/egress/fetch-approved-resource";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getConsensusRepository } from "@/server/persistence/get-consensus-repository";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getValuationJobStore } from "@/server/persistence/get-valuation-job-store";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

/**
 * Composition root of the consensus capture on opening a valuation
 * (`F6-29`, [ADR 0083](../../../docs/architecture/adr/0083-consensus-estimates-forward-pe.md)).
 *
 * Reached only from the Server Action, which already checked the mode, and
 * only for a security the caller took from a recorded valuation run: the
 * request never names what is downloaded. One worker per process; between
 * processes the source's lease decides (ADR 0015).
 */
let activeWorker: Promise<void> | null = null;

/** Every run engine the job records carries its subject's security. */
const recordedSubjectSchema = z.object({
  subject: z.object({ securityId: z.uuid(), legalEntityId: z.uuid() }),
});

export type ValuedSubject = {
  readonly securityId: string;
  readonly legalEntityId: string;
};

const now = () => new Date().toISOString();

function dependencies() {
  return {
    consensus: getConsensusRepository(),
    jobs: getIngestionJobStore(),
    budgets: getSourceBudgetStore(),
    now,
    workerActive: () => activeWorker !== null,
  };
}

/**
 * The subject of a ticker's latest recorded valuation run, or `null`. Only a
 * valued company is captured or gets a threshold: an arbitrary symbol cannot
 * spend the quota or write a row.
 */
export async function subjectOfValuedTicker(
  ticker: string,
): Promise<ValuedSubject | null> {
  const jobs = await getValuationJobStore().listCompletedByTicker(ticker, 20);
  const recorded = jobs.find((job) => job.valuationRunId !== null);
  if (recorded === undefined) return null;
  const run = await getValuationRunRepository().findById(
    recorded.valuationRunId!,
  );
  const parsed = recordedSubjectSchema.safeParse(run);
  return parsed.success ? parsed.data.subject : null;
}

/** The forward P/E block and whether the page should ask for a capture. */
export async function readForwardMultiplesForRender(
  subject: ValuedSubject,
): Promise<{
  readonly view: ForwardMultiplesView;
  readonly readiness: {
    readonly needsRefresh: boolean;
    readonly failed: boolean;
  };
}> {
  const [view, readiness] = await Promise.all([
    loadForwardMultiples(
      { ...subject, now: now() },
      { consensus: getConsensusRepository(), prices: getPriceRepository() },
    ),
    readConsensusReadiness({ securityId: subject.securityId }, dependencies()),
  ]);
  return { view, readiness };
}

/** One more append-only revision of the owner's forward P/E threshold. */
export async function declareForwardPeThresholdForRequest(input: {
  readonly legalEntityId: string;
  readonly value: string | null;
}): Promise<void> {
  await getConsensusRepository().declareThreshold({
    thresholdId: randomUUID(),
    legalEntityId: input.legalEntityId,
    metric: "forward_pe",
    value: input.value,
    reason: null,
    declaredAt: now(),
  });
}

export async function ensureConsensusForRequest(input: {
  readonly securityId: string;
  readonly retryFailures: boolean;
}): Promise<EnsureConsensusResult> {
  return ensureConsensus(
    {
      ...input,
      credentialReady:
        credentialProblem(process.env.ALPHA_VANTAGE_API_KEY) === null,
    },
    dependencies(),
  );
}

/** Starts the job's worker unless this process already runs one. */
export function startConsensusWorker(jobId: string): Promise<void> {
  if (activeWorker !== null) return activeWorker;
  activeWorker = runConsensusRefreshJob(jobId)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Only the type: a message can carry a host, a port or SQL (`TM-02`).
      console.error(
        "consensus refresh worker failed",
        error instanceof Error ? error.name : typeof error,
      );
    })
    .finally(() => {
      activeWorker = null;
    });
  return activeWorker;
}

async function runConsensusRefreshJob(jobId: string) {
  const store = getIngestionJobStore();
  const job = await store.getJob(jobId);
  if (job === null) return null;
  assertConsensusRefreshJob(job);

  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

  const signals = observeSourceSignals(getMeteredEgressFetch());
  const jobFetch = createPacedEgressFetch(
    signals.fetch,
    CONSENSUS_REQUEST_PACING,
    { elapsedMs: () => performance.now(), sleep: (ms) => sleep(ms) },
  );
  const source = createLiveConsensusSource({
    sourceRegistry: registry,
    fetch: jobFetch,
  });
  const state = await getUniverseRepository().loadState({
    indexId: SP500_INDEX_ID,
  });
  const holder = `web/${hostname().replace(/[^A-Za-z0-9.-]/gu, "-")}/${process.pid}/${randomUUID().slice(0, 8)}`;

  return runIngestionJob(
    { jobId, holder },
    {
      store,
      execute: createConsensusRefreshJobExecutor({
        captureSecurity: async (securityId) => {
          const at = now();
          const cutoff = pointInTimeQuerySchema.parse({
            effectiveAt: at,
            revisionPolicy: "as_known",
            knownAt: at,
            sourcePolicyVersion: "source-policy-1.0.0",
          });
          const [ticker] = securityTickersAt(state.graph, securityId, cutoff);
          if (ticker === undefined) {
            throw new ConsensusSubjectUnresolvedError(securityId);
          }
          const outcome = await recordConsensus(
            { securityId, symbol: ticker.symbol },
            {
              source,
              repository: getConsensusRepository(),
              ingestionRuns: getIngestionRunRepository(),
              now,
              newId: () => randomUUID(),
              hashContent: (input) =>
                createHash("sha256").update(input).digest("hex"),
            },
          );
          return outcome.runId!;
        },
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
      admitItem: createConsensusRefreshAdmission({
        fetch: jobFetch,
        pacing: CONSENSUS_REQUEST_PACING,
        budgets: getSourceBudgetStore(),
        now,
      }),
    },
  );
}
