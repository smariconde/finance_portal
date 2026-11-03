import { ADR_PAIR_DATASET_ID } from "@/modules/implied-fx/application/ingest-adr-pair-legs";
import {
  DECLARED_ADR_PAIRS,
  legIdOf,
} from "@/modules/implied-fx/domain/declared-adr-pairs";
import type {
  PacedEgressFetch,
  RequestPacingPolicy,
} from "@/modules/ingestion/application/egress-fetch";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
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
import { INDEC_DATASET_ID } from "@/modules/macro-series/application/live-indec-source";
import { INDEC_API_PARSER_VERSION } from "@/modules/macro-series/domain/indec-api-parser";
import { ARGENTINA_SERIES_DATASET_ID } from "@/modules/macro-series/application/live-argentina-series-source";
import { ARGENTINA_SERIES_PARSER_VERSION } from "@/modules/macro-series/domain/argentina-series-parser";
import { BCRA_MONETARY_PROFILE } from "@/modules/macro-series/domain/bcra-source-profile";
import { DECLARED_ARGENTINA_INDICATORS } from "@/modules/macro-series/domain/declared-argentina-indicators";
import { CHART_PARSER_VERSION } from "@/modules/prices/domain/parse-chart-payload";

import {
  ARGENTINA_REFRESH_RULE_VERSION,
  freshSince,
  selectStaleSubjects,
  type RefreshCadence,
} from "../domain/refresh-freshness";

import { DASHBOARD_BCRA_VARIABLES } from "./load-argentina-dashboard";

/**
 * The series of `/argentina` are brought up to date when the page opens
 * (`F9-12`, [ADR 0070](../../../../docs/architecture/adr/0070-argentina-refresh-on-open.md)).
 * One durable job per source (ADR 0015), so each one runs under its own lease
 * and its own daily budget (ADR 0020); only the subjects past their cadence
 * are planned, and a subject that a job already checked is not planned again
 * on its own: a failure waits for «Reintentar».
 */
export const ARGENTINA_REFRESH_KIND = "argentina_data_refresh";

/** Every item is one request: a page of a series or a chart of a leg. */
export const MAX_REQUESTS_PER_REFRESH_ITEM = 1;

/** Completed jobs read to know what a job already checked. */
const RECENT_JOBS_LIMIT = 25;

/** Ingestion runs read per source to know the last check of each subject. */
const RECENT_RUNS_LIMIT = 100;

export type RefreshSourceId =
  | "bcra-monetarias-v4"
  | "yahoo-finance"
  | "indec-api"
  | "argentina-series-tiempo";

export type RefreshSource = {
  readonly sourceId: RefreshSourceId;
  readonly datasetId: string;
  readonly parserVersion: string;
  readonly cadence: RefreshCadence;
  /** How the page names it in a status line. */
  readonly label: string;
  /** What the page reads from this source, in plan order. */
  readonly subjects: readonly string[];
};

/** Only what `/argentina` reads: the rest stays a hand-run command. */
export const ARGENTINA_REFRESH_SOURCES: readonly RefreshSource[] = [
  {
    sourceId: "bcra-monetarias-v4",
    datasetId: BCRA_MONETARY_PROFILE.observationsDatasetId,
    parserVersion: BCRA_MONETARY_PROFILE.parserVersion,
    cadence: "daily",
    label: "BCRA",
    subjects: Object.values(DASHBOARD_BCRA_VARIABLES).map(String),
  },
  {
    sourceId: "yahoo-finance",
    datasetId: ADR_PAIR_DATASET_ID,
    parserVersion: CHART_PARSER_VERSION,
    cadence: "daily",
    label: "pares ADR del CCL",
    subjects: DECLARED_ADR_PAIRS.flatMap((pair) => [
      legIdOf(pair.pairId, "adr"),
      legIdOf(pair.pairId, "local"),
    ]),
  },
  {
    sourceId: "indec-api",
    datasetId: INDEC_DATASET_ID,
    parserVersion: INDEC_API_PARSER_VERSION,
    cadence: "monthly",
    label: "INDEC",
    subjects: DECLARED_ARGENTINA_INDICATORS.filter(
      (item) => item.sourceId === "indec-api",
    ).map((item) => item.id),
  },
  {
    sourceId: "argentina-series-tiempo",
    datasetId: ARGENTINA_SERIES_DATASET_ID,
    parserVersion: ARGENTINA_SERIES_PARSER_VERSION,
    cadence: "monthly",
    label: "Series de Tiempo",
    subjects: DECLARED_ARGENTINA_INDICATORS.filter(
      (item) => item.sourceId === "argentina-series-tiempo",
    ).map((item) => item.id),
  },
];

export function refreshSourceOf(sourceId: string): RefreshSource {
  const source = ARGENTINA_REFRESH_SOURCES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!source) throw new Error(`refresh_source_not_declared: ${sourceId}`);
  return source;
}

export function buildArgentinaRefreshPlan(
  source: RefreshSource,
  subjects: readonly string[],
): IngestionJobPlanInput {
  return {
    kind: ARGENTINA_REFRESH_KIND,
    sourceId: source.sourceId,
    datasetId: source.datasetId,
    parserVersion: source.parserVersion,
    selectionVersion: ARGENTINA_REFRESH_RULE_VERSION,
    subjects: [...subjects],
  };
}

export type ArgentinaRefreshDependencies = {
  readonly jobs: IngestionJobStore;
  readonly ingestionRuns: IngestionRunRepository;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
};

type SourceAssessment = {
  readonly source: RefreshSource;
  /** Past their cadence and not checked by a job since: to plan. */
  readonly stale: readonly string[];
  /** Checked by a job since the threshold without a run to show for it. */
  readonly failed: readonly string[];
};

/**
 * The last check of each subject: its latest recorded run —a hand-run command
 * counts too— and, unless the owner asked to retry, the job that last reached
 * it, which covers a request that failed before recording anything.
 */
async function assessSource(
  source: RefreshSource,
  completedJobs: readonly IngestionJob[],
  dependencies: ArgentinaRefreshDependencies,
  retryFailures: boolean,
): Promise<SourceAssessment> {
  const now = dependencies.now();
  const runs = await dependencies.ingestionRuns.list({
    sourceId: source.sourceId,
    datasetId: source.datasetId,
    limit: RECENT_RUNS_LIMIT,
  });
  const recorded = new Map<string, string>();
  for (const run of runs) {
    if (run.subjectKey === null || run.status === "failed") continue;
    const previous = recorded.get(run.subjectKey);
    if (previous === undefined || previous < run.recordedAt) {
      recorded.set(run.subjectKey, run.recordedAt);
    }
  }

  const checkedByJob = new Map<string, string>();
  for (const job of completedJobs.filter(
    (candidate) => candidate.sourceId === source.sourceId,
  )) {
    const items = await dependencies.jobs.listItems({
      jobId: job.jobId,
      limit: 1000,
    });
    for (const item of items) {
      if (!isTerminalItemStatus(item.status)) continue;
      const previous = checkedByJob.get(item.subjectKey);
      if (previous === undefined || previous < job.createdAt) {
        checkedByJob.set(item.subjectKey, job.createdAt);
      }
    }
  }

  const since = freshSince(source.cadence, now);
  const lastChecks = new Map(recorded);
  if (!retryFailures) {
    for (const [subject, checkedAt] of checkedByJob) {
      const previous = lastChecks.get(subject);
      if (previous === undefined || previous < checkedAt) {
        lastChecks.set(subject, checkedAt);
      }
    }
  }

  return {
    source,
    stale: selectStaleSubjects({
      subjects: source.subjects,
      lastChecks,
      cadence: source.cadence,
      now,
    }),
    failed: source.subjects.filter((subject) => {
      const byJob = checkedByJob.get(subject);
      const byRun = recorded.get(subject);
      return (
        byJob !== undefined &&
        byJob >= since &&
        (byRun === undefined || byRun < since)
      );
    }),
  };
}

async function assessAll(
  dependencies: ArgentinaRefreshDependencies,
  retryFailures: boolean,
): Promise<readonly SourceAssessment[]> {
  const completed = (
    await Promise.all(
      ARGENTINA_REFRESH_SOURCES.map((source) =>
        dependencies.jobs.listJobs({
          sourceId: source.sourceId,
          statuses: ["completed"],
          limit: RECENT_JOBS_LIMIT,
        }),
      ),
    )
  )
    .flat()
    .filter((job) => job.kind === ARGENTINA_REFRESH_KIND);
  return Promise.all(
    ARGENTINA_REFRESH_SOURCES.map((source) =>
      assessSource(source, completed, dependencies, retryFailures),
    ),
  );
}

export async function openRefreshJobs(
  jobs: IngestionJobStore,
): Promise<readonly IngestionJob[]> {
  return (
    await Promise.all(
      ARGENTINA_REFRESH_SOURCES.map((source) =>
        jobs.listJobs({
          sourceId: source.sourceId,
          statuses: ["open", "paused"],
          limit: 10,
        }),
      ),
    )
  )
    .flat()
    .filter((job) => job.kind === ARGENTINA_REFRESH_KIND);
}

/**
 * What the page sees: counts, source labels and codes. Never an error
 * message, which can carry a host or a statement (`TM-02`).
 */
export type ArgentinaRefreshStatus =
  | {
      readonly state: "fresh";
      /** Sources with subjects a job checked and could not bring. */
      readonly failedSources: readonly string[];
    }
  | {
      readonly state: "running";
      readonly done: number;
      readonly total: number;
      readonly failed: number;
      /** Labels of the sources still being asked. */
      readonly sources: readonly string[];
      /** The latest backoff a source asked for, if it is waiting. */
      readonly waitingUntil: string | null;
    }
  | {
      readonly state: "blocked";
      readonly reason:
        | "source_disabled"
        | "daily_budget_exhausted"
        | "job_paused"
        | "budget_undeclared";
      readonly source: string;
      readonly resumesAt: string | null;
    };

export type EnsureArgentinaRefreshResult = {
  readonly status: ArgentinaRefreshStatus;
  /** Whether a worker must start for the open jobs. */
  readonly runWorker: boolean;
};

async function admissionBlock(
  budgets: SourceBudgetStore,
  source: RefreshSource,
  now: string,
): Promise<Extract<ArgentinaRefreshStatus, { state: "blocked" }> | null> {
  const verdict = await checkSourceBudget(
    budgets,
    source.sourceId,
    MAX_REQUESTS_PER_REFRESH_ITEM,
    now,
  );
  switch (verdict.status) {
    case "allowed":
      return null;
    case "daily_budget_exhausted":
      return {
        state: "blocked",
        reason: "daily_budget_exhausted",
        source: source.label,
        resumesAt: verdict.resumesAt,
      };
    case "source_disabled":
    case "budget_undeclared":
      return {
        state: "blocked",
        reason: verdict.status,
        source: source.label,
        resumesAt: null,
      };
  }
}

async function describeOpenJobs(
  open: readonly IngestionJob[],
  dependencies: ArgentinaRefreshDependencies & {
    readonly workerActive: () => boolean;
  },
): Promise<EnsureArgentinaRefreshResult> {
  const now = dependencies.now();
  // Jobs of the same round that already finished still count, so the
  // progress never moves backwards when one source completes.
  const roundStart = open
    .map((job) => job.createdAt)
    .sort()
    .at(0)!;
  const finished = (
    await Promise.all(
      ARGENTINA_REFRESH_SOURCES.map((source) =>
        dependencies.jobs.listJobs({
          sourceId: source.sourceId,
          statuses: ["completed"],
          limit: 5,
        }),
      ),
    )
  )
    .flat()
    .filter(
      (job) =>
        job.kind === ARGENTINA_REFRESH_KIND && job.createdAt >= roundStart,
    );
  const runnable = open.filter((job) => job.status === "open");
  if (runnable.length === 0) {
    return {
      status: {
        state: "blocked",
        reason: "job_paused",
        source: refreshSourceOf(open[0]!.sourceId).label,
        resumesAt: null,
      },
      runWorker: false,
    };
  }

  let done = 0;
  let total = 0;
  let failed = 0;
  const waits: string[] = [];
  let anyRunnableNow = false;
  for (const job of finished) {
    const counts = await dependencies.jobs.countItems(job.jobId);
    done += job.itemCount;
    failed += counts.failed + counts.poisoned;
    total += job.itemCount;
  }
  for (const job of runnable) {
    const [counts, next, lease] = await Promise.all([
      dependencies.jobs.countItems(job.jobId),
      dependencies.jobs.peekNext(job.jobId),
      dependencies.jobs.getLease(job.sourceId),
    ]);
    done += counts.completed + counts.failed + counts.poisoned;
    failed += counts.failed + counts.poisoned;
    total += job.itemCount;
    const jobWaits = [job.notBefore, next.item?.notBefore ?? null].filter(
      (instant): instant is string =>
        instant !== null && Date.parse(instant) > Date.parse(now),
    );
    waits.push(...jobWaits);
    const leaseLive =
      lease !== null && Date.parse(lease.expiresAt) > Date.parse(now);
    if (jobWaits.length === 0 && !leaseLive) anyRunnableNow = true;
  }

  return {
    status: {
      state: "running",
      done,
      total,
      failed,
      sources: runnable.map((job) => refreshSourceOf(job.sourceId).label),
      waitingUntil: waits.sort().at(-1) ?? null,
    },
    runWorker: anyRunnableNow && !dependencies.workerActive(),
  };
}

/**
 * One step: the open refresh jobs if there are any; otherwise one new job per
 * source with stale subjects; otherwise `fresh`. Idempotent: while a job is
 * open nothing else is planned, and an equal plan returns the existing job.
 */
export async function ensureArgentinaRefresh(
  input: { readonly retryFailures: boolean },
  dependencies: ArgentinaRefreshDependencies & {
    readonly workerActive: () => boolean;
  },
): Promise<EnsureArgentinaRefreshResult> {
  const open = await openRefreshJobs(dependencies.jobs);
  if (open.length > 0) return describeOpenJobs(open, dependencies);

  const assessments = await assessAll(dependencies, input.retryFailures);
  const now = dependencies.now();
  const planned: IngestionJob[] = [];
  let blocked: Extract<ArgentinaRefreshStatus, { state: "blocked" }> | null =
    null;

  for (const assessment of assessments) {
    if (assessment.stale.length === 0) continue;
    // A stopped or exhausted source leaves no job that nobody can run.
    const refusal = await admissionBlock(
      dependencies.budgets,
      assessment.source,
      now,
    );
    if (refusal !== null) {
      blocked ??= refusal;
      continue;
    }
    const { job } = await dependencies.jobs.createJob(
      buildArgentinaRefreshPlan(assessment.source, assessment.stale),
      { now },
    );
    planned.push(job);
  }

  if (planned.length > 0) return describeOpenJobs(planned, dependencies);
  if (blocked !== null) return { status: blocked, runWorker: false };

  return {
    status: {
      state: "fresh",
      failedSources: assessments
        .filter((assessment) => assessment.failed.length > 0)
        .map((assessment) => assessment.source.label),
    },
    runWorker: false,
  };
}

export type ArgentinaRefreshReadiness = {
  /** Something to ask for, or a refresh in progress to follow. */
  readonly needsRefresh: boolean;
  readonly failedSources: readonly string[];
};

/**
 * What the render needs, **without writing**: a page plans no job and opens
 * no socket while it draws. Asking is the Server Action's job.
 */
export async function readArgentinaRefreshReadiness(
  dependencies: ArgentinaRefreshDependencies,
): Promise<ArgentinaRefreshReadiness> {
  const [open, assessments] = await Promise.all([
    openRefreshJobs(dependencies.jobs),
    assessAll(dependencies, false),
  ]);
  return {
    needsRefresh:
      open.some((job) => job.status === "open") ||
      assessments.some((assessment) => assessment.stale.length > 0),
    failedSources: assessments
      .filter((assessment) => assessment.failed.length > 0)
      .map((assessment) => assessment.source.label),
  };
}

export class ArgentinaRefreshJobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgentinaRefreshJobMismatchError";
  }
}

/** A job planned under another rule or parser does not run with this code. */
export function assertArgentinaRefreshJob(job: IngestionJob): RefreshSource {
  const source = refreshSourceOf(job.sourceId);
  const expected = {
    kind: ARGENTINA_REFRESH_KIND,
    datasetId: source.datasetId,
    parserVersion: source.parserVersion,
    selectionVersion: ARGENTINA_REFRESH_RULE_VERSION,
  };
  for (const [field, value] of Object.entries(expected)) {
    const actual = job[field as keyof typeof expected];
    if (actual !== value) {
      throw new ArgentinaRefreshJobMismatchError(
        `Job ${job.jobId} was planned with ${field} ${String(actual)}; this code runs ${value}.`,
      );
    }
  }
  return source;
}

/** Item admission: the run's budget and the source's two controls (ADR 0020). */
export function createArgentinaRefreshAdmission(dependencies: {
  readonly source: RefreshSource;
  readonly fetch: PacedEgressFetch;
  readonly pacing: RequestPacingPolicy;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    if (
      dependencies.fetch.requestCount() + MAX_REQUESTS_PER_REFRESH_ITEM >
      dependencies.pacing.maxRequests
    ) {
      return { status: "budget_reserve" };
    }
    const blocked = await admissionBlock(
      dependencies.budgets,
      dependencies.source,
      dependencies.now(),
    );
    if (blocked === null) return { status: "ready" };
    if (blocked.reason === "daily_budget_exhausted") {
      return {
        status: "daily_budget_exhausted",
        resumesAt: blocked.resumesAt!,
      };
    }
    return {
      status: "source_disabled",
      reason: `${dependencies.source.sourceId}: ${blocked.reason}`,
    };
  };
}

/** A subject the recorder refuses by name: asking again gives the same answer. */
export class RefreshSubjectRejectedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RefreshSubjectRejectedError";
  }
}

/** Errors a source adapter names with a `code`, by what asking again changes. */
const SOURCE_LEVEL_CODES = new Set([
  "rights_not_approved",
  "source_not_registered",
  "unauthorized",
]);
const SUBJECT_LEVEL_CODES = new Set([
  "not_declared",
  "schema_changed",
  "no_rows",
  "payload_rejected",
  "leg_currency_mismatch",
  "pagination_failed",
]);

export function createArgentinaRefreshExecutor(dependencies: {
  /** Records one subject of the job's source; returns its ingestion run. */
  readonly record: (job: IngestionJob, subjectKey: string) => Promise<string>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  return async (item, job) => {
    // A signal from an earlier attempt is not this one's.
    dependencies.takeSignal();
    try {
      const runId = await dependencies.record(job, item.subjectKey);
      return { kind: "ingested", ingestionRunId: runId };
    } catch (cause) {
      return classifyRefreshFailure(cause, dependencies.takeSignal());
    }
  };
}

function classifyRefreshFailure(
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
  if (cause instanceof RefreshSubjectRejectedError) {
    return { kind: "subject_rejected", message: cause.code };
  }
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : null;
  if (code !== null && SOURCE_LEVEL_CODES.has(code)) {
    return {
      kind: "source_signal",
      signal: "refused",
      ingestionRunId: null,
      retryAfter: null,
      message: code,
    };
  }
  if (code !== null && SUBJECT_LEVEL_CODES.has(code)) {
    return { kind: "subject_rejected", message: code };
  }
  if (cause instanceof Error) {
    return {
      kind: "executor_error",
      message: `${cause.name}: ${code ?? "error"}`,
    };
  }
  throw cause;
}
