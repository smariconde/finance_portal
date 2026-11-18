import type {
  PacedEgressFetch,
  RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import type {
  IngestionJobAdmission,
  IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import type { SourceSignal } from "@/modules/ingestion/application/source-signals";
import {
  isTerminalItemStatus,
  type IngestionJob,
  type IngestionJobAttemptOutcome,
  type IngestionJobPlanInput,
} from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import {
  assessConsensusFreshness,
  CONSENSUS_FRESHNESS_VERSION,
  type ConsensusCheck,
  type ConsensusFreshness,
} from "../domain/consensus-freshness";
import { EARNINGS_ESTIMATES_PARSER_VERSION } from "../domain/earnings-estimates-parser";
import {
  CONSENSUS_DATASET_ID,
  type ConsensusRepository,
} from "./consensus-repository";
import {
  CONSENSUS_SOURCE_ID,
  ConsensusSourceError,
} from "./live-consensus-source";

/**
 * The consensus on opening a valuation (ADR 0083), the way a sector asks for
 * its prices (ADR 0030): one durable job of one item under the source's lease,
 * budget and kill switch. The render only reads; the Server Action plans and
 * the page polls it.
 */
export const CONSENSUS_REFRESH_KIND = "alpha_vantage_consensus_refresh";

/** One `EARNINGS_ESTIMATES` request per item. */
export const MAX_REQUESTS_PER_CONSENSUS_ITEM = 1;

const RECENT_JOBS_LIMIT = 25;

export function buildConsensusRefreshJobPlan(
  securityId: string,
): IngestionJobPlanInput {
  return {
    kind: CONSENSUS_REFRESH_KIND,
    sourceId: CONSENSUS_SOURCE_ID,
    datasetId: CONSENSUS_DATASET_ID,
    parserVersion: EARNINGS_ESTIMATES_PARSER_VERSION,
    selectionVersion: CONSENSUS_FRESHNESS_VERSION,
    subjects: [securityId],
  };
}

export class ConsensusRefreshJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsensusRefreshJobMismatchError";
  }
}

/** A job planned under another rule or parser is not run by this code. */
export function assertConsensusRefreshJob(job: IngestionJob): void {
  const expected = buildConsensusRefreshJobPlan("x");
  for (const field of [
    "kind",
    "sourceId",
    "datasetId",
    "parserVersion",
    "selectionVersion",
  ] as const) {
    if (job[field] !== expected[field]) {
      throw new ConsensusRefreshJobMismatchError(
        `Job ${job.jobId} was planned with ${field} ${String(job[field])}; this code runs ${String(expected[field])}.`,
      );
    }
  }
}

/** The latest finished check of a security by a refresh job. */
async function lastCheckOf(
  jobs: IngestionJobStore,
  securityId: string,
): Promise<ConsensusCheck | null> {
  const recent = (
    await jobs.listJobs({
      sourceId: CONSENSUS_SOURCE_ID,
      statuses: ["completed"],
      limit: RECENT_JOBS_LIMIT,
    })
  ).filter((job) => job.kind === CONSENSUS_REFRESH_KIND);
  for (const job of recent) {
    const [item] = await jobs.listItems({ jobId: job.jobId, limit: 1 });
    if (
      item !== undefined &&
      item.subjectKey === securityId &&
      isTerminalItemStatus(item.status)
    ) {
      return {
        checkedAt: job.createdAt,
        failed: item.status !== "completed",
      };
    }
  }
  return null;
}

export type ConsensusRefreshDependencies = {
  readonly consensus: Pick<ConsensusRepository, "captures">;
  readonly jobs: IngestionJobStore;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
  /** Whether this process already runs a consensus worker. */
  readonly workerActive: () => boolean;
};

/** What the page sees: counts and codes, never an error message (`TM-02`). */
export type ConsensusRefreshStatus =
  | {
      readonly state: "fresh";
      readonly capturedAt: string;
    }
  | {
      /** Checked today and still without a capture: «Reintentar». */
      readonly state: "failed";
      readonly capturedAt: string | null;
    }
  | {
      readonly state: "running";
      /** Another security's capture holds the source. */
      readonly other: boolean;
      readonly waitingUntil: string | null;
    }
  | {
      readonly state: "blocked";
      readonly reason:
        | "source_disabled"
        | "daily_budget_exhausted"
        | "job_paused"
        | "budget_undeclared"
        | "credential_missing";
      readonly resumesAt: string | null;
    };

export type EnsureConsensusResult = {
  readonly status: ConsensusRefreshStatus;
  /** Start a worker for this job after answering. */
  readonly runJobId: string | null;
};

async function admissionBlock(
  budgets: SourceBudgetStore,
  now: string,
): Promise<ConsensusRefreshStatus | null> {
  const verdict = await checkSourceBudget(
    budgets,
    CONSENSUS_SOURCE_ID,
    MAX_REQUESTS_PER_CONSENSUS_ITEM,
    now,
  );
  switch (verdict.status) {
    case "allowed":
      return null;
    case "source_disabled":
    case "budget_undeclared":
      return { state: "blocked", reason: verdict.status, resumesAt: null };
    case "daily_budget_exhausted":
      return {
        state: "blocked",
        reason: "daily_budget_exhausted",
        resumesAt: verdict.resumesAt,
      };
  }
}

async function describeOpenJob(
  job: IngestionJob,
  securityId: string,
  dependencies: ConsensusRefreshDependencies,
): Promise<EnsureConsensusResult> {
  const { jobs } = dependencies;
  const now = dependencies.now();
  if (job.status === "paused") {
    return {
      status: { state: "blocked", reason: "job_paused", resumesAt: null },
      runJobId: null,
    };
  }
  const [next, lease, [item]] = await Promise.all([
    jobs.peekNext(job.jobId),
    jobs.getLease(CONSENSUS_SOURCE_ID),
    jobs.listItems({ jobId: job.jobId, limit: 1 }),
  ]);
  const waits = [job.notBefore, next.item?.notBefore ?? null].filter(
    (instant): instant is string =>
      instant !== null && Date.parse(instant) > Date.parse(now),
  );
  const waitingUntil = waits.sort().at(-1) ?? null;
  const leaseLive =
    lease !== null && Date.parse(lease.expiresAt) > Date.parse(now);

  let runJobId: string | null = null;
  if (waitingUntil === null && !leaseLive && !dependencies.workerActive()) {
    const blocked = await admissionBlock(dependencies.budgets, now);
    if (blocked !== null) return { status: blocked, runJobId: null };
    runJobId = job.jobId;
  }
  return {
    status: {
      state: "running",
      other: item !== undefined && item.subjectKey !== securityId,
      waitingUntil,
    },
    runJobId,
  };
}

export async function assessConsensus(
  input: { readonly securityId: string; readonly retryFailures?: boolean },
  dependencies: Pick<
    ConsensusRefreshDependencies,
    "consensus" | "jobs" | "now"
  >,
): Promise<ConsensusFreshness> {
  const [captures, lastCheck] = await Promise.all([
    dependencies.consensus.captures(input.securityId),
    lastCheckOf(dependencies.jobs, input.securityId),
  ]);
  return assessConsensusFreshness({
    captures,
    lastCheck,
    now: dependencies.now(),
    retryFailures: input.retryFailures ?? false,
  });
}

/**
 * One idempotent step: the open consensus job's state, or a new job for this
 * security when its consensus is due, or `fresh`. Two calls never plan two
 * jobs: while one is open no other is planned.
 */
export async function ensureConsensus(
  input: {
    readonly securityId: string;
    readonly retryFailures: boolean;
    /** The door would refuse without it; say so instead of failing the job. */
    readonly credentialReady: boolean;
  },
  dependencies: ConsensusRefreshDependencies,
): Promise<EnsureConsensusResult> {
  const { jobs } = dependencies;
  const open = (
    await jobs.listJobs({
      sourceId: CONSENSUS_SOURCE_ID,
      statuses: ["open", "paused"],
      limit: 10,
    })
  ).filter((job) => job.kind === CONSENSUS_REFRESH_KIND);
  const current = open.at(-1);
  if (current !== undefined) {
    return describeOpenJob(current, input.securityId, dependencies);
  }

  const freshness = await assessConsensus(input, dependencies);
  if (freshness.status === "fresh") {
    return {
      status: { state: "fresh", capturedAt: freshness.capturedAt },
      runJobId: null,
    };
  }
  if (freshness.status === "failed") {
    return {
      status: { state: "failed", capturedAt: freshness.capturedAt },
      runJobId: null,
    };
  }
  if (!input.credentialReady) {
    return {
      status: {
        state: "blocked",
        reason: "credential_missing",
        resumesAt: null,
      },
      runJobId: null,
    };
  }
  const blocked = await admissionBlock(
    dependencies.budgets,
    dependencies.now(),
  );
  if (blocked !== null) return { status: blocked, runJobId: null };

  const { job } = await jobs.createJob(
    buildConsensusRefreshJobPlan(input.securityId),
    { now: dependencies.now() },
  );
  return describeOpenJob(job, input.securityId, dependencies);
}

/**
 * The render's question, **without writing**: whether the page should call
 * the action at all.
 */
export async function readConsensusReadiness(
  input: { readonly securityId: string },
  dependencies: Pick<
    ConsensusRefreshDependencies,
    "consensus" | "jobs" | "now"
  >,
): Promise<{ readonly needsRefresh: boolean; readonly failed: boolean }> {
  const [freshness, open] = await Promise.all([
    assessConsensus(input, dependencies),
    dependencies.jobs.listJobs({
      sourceId: CONSENSUS_SOURCE_ID,
      statuses: ["open"],
      limit: 10,
    }),
  ]);
  const running = open.some((job) => job.kind === CONSENSUS_REFRESH_KIND);
  return {
    needsRefresh: running || freshness.status === "stale",
    failed: freshness.status === "failed",
  };
}

/** The run budget and the source's two daily controls (ADR 0020). */
export function createConsensusRefreshAdmission(dependencies: {
  readonly fetch: PacedEgressFetch;
  readonly pacing: RequestPacingPolicy;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    if (
      dependencies.fetch.requestCount() + MAX_REQUESTS_PER_CONSENSUS_ITEM >
      dependencies.pacing.maxRequests
    ) {
      return { status: "budget_reserve" };
    }
    const blocked = await admissionBlock(
      dependencies.budgets,
      dependencies.now(),
    );
    if (blocked === null) return { status: "ready" };
    if (
      blocked.state === "blocked" &&
      blocked.reason === "daily_budget_exhausted"
    ) {
      return {
        status: "daily_budget_exhausted",
        resumesAt: blocked.resumesAt!,
      };
    }
    return {
      status: "source_disabled",
      reason:
        blocked.state === "blocked" && blocked.reason === "budget_undeclared"
          ? `${CONSENSUS_SOURCE_ID} no tiene presupuesto diario declarado`
          : `${CONSENSUS_SOURCE_ID} está frenada por el owner`,
    };
  };
}

export class ConsensusSubjectUnresolvedError extends Error {
  constructor(securityId: string) {
    super(`Security ${securityId} has no current ticker.`);
    this.name = "ConsensusSubjectUnresolvedError";
  }
}

export function createConsensusRefreshJobExecutor(dependencies: {
  /** Captures one security; returns the recorded run. */
  readonly captureSecurity: (securityId: string) => Promise<string>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  return async (item) => {
    dependencies.takeSignal();
    try {
      return {
        kind: "ingested",
        ingestionRunId: await dependencies.captureSecurity(item.subjectKey),
      };
    } catch (cause) {
      return classifyConsensusFailure(cause, dependencies.takeSignal());
    }
  };
}

export function classifyConsensusFailure(
  cause: unknown,
  signal: SourceSignal | null,
): IngestionJobAttemptOutcome {
  if (signal !== null) {
    return {
      kind: "source_signal",
      signal: signal.kind,
      ingestionRunId: null,
      retryAfter: signal.retryAfter,
      message: signal.detail,
    };
  }
  if (cause instanceof SourceRequestRefusedError) {
    return {
      kind: "source_signal",
      signal: "refused",
      ingestionRunId: null,
      retryAfter: null,
      message: cause.code,
    };
  }
  if (cause instanceof ConsensusSubjectUnresolvedError) {
    return { kind: "subject_rejected", message: cause.message };
  }
  if (cause instanceof ConsensusSourceError) {
    switch (cause.code) {
      // The plan's limit answers 200 with a note: a quota signal, not the
      // subject's fault.
      case "rate_limited":
        return {
          kind: "source_signal",
          signal: "throttled",
          ingestionRunId: null,
          retryAfter: cause.retryAfter,
          message: cause.code,
        };
      case "rights_not_approved":
        return {
          kind: "source_signal",
          signal: "refused",
          ingestionRunId: null,
          retryAfter: null,
          message: cause.code,
        };
      // A payload the parser rejects does not change by asking again; a symbol
      // with no fiscal years is the same.
      case "schema_changed":
        return { kind: "subject_rejected", message: cause.message };
      case "fetch_failed":
      case "unexpected_status":
        return { kind: "executor_error", message: cause.message };
    }
  }
  throw cause;
}
