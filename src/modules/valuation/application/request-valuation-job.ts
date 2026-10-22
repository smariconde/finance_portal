import {
  addMilliseconds,
  queueValuationJob,
  outcomeForFailure,
  toValuationJobView,
  valuationTickerSchema,
  VALUATION_JOB_HEARTBEAT_MS,
  VALUATION_JOB_STALE_AFTER_MS,
  type ValuationJob,
  type ValuationJobOutcome,
  type ValuationJobView,
} from "../domain/valuation-job";
import {
  ValuationJobConflictError,
  type ValuationJobStore,
} from "./valuation-job-store";

/**
 * Pide o consulta la corrida de un ticker (`F6-01`).
 *
 * `status` no crea filas. `enqueue` crea una sólo si no hay otra abierta para
 * ese símbolo. El worker corre después, fuera de esta función.
 */
export type ValuationJobRequest = {
  readonly ticker: string;
  readonly intent: "enqueue" | "status";
};

export type ValuationJobRequestResult = {
  readonly view: ValuationJobView;
  /** Job en cola o en curso que este proceso puede tomar. `null` si no hay trabajo. */
  readonly runJobId: string | null;
};

export type ValuationJobRunnerDependencies = {
  readonly store: ValuationJobStore;
  readonly now: () => string;
  readonly newId: () => string;
  readonly assess: (job: ValuationJob) => Promise<ValuationJobOutcome>;
  /**
   * Arranca un latido periódico y devuelve cómo pararlo (`F6-05`). La raíz de
   * composición usa un temporizador; sin él, el job no late.
   */
  readonly startHeartbeat?: (
    beat: () => Promise<void>,
    intervalMs: number,
  ) => () => void;
};

export async function requestValuationJob(
  input: ValuationJobRequest,
  dependencies: Pick<ValuationJobRunnerDependencies, "store" | "now" | "newId">,
): Promise<ValuationJobRequestResult> {
  const ticker = valuationTickerSchema.parse(input.ticker);
  const open = await dependencies.store.findOpenByTicker(ticker);

  if (open !== null) {
    return { view: toValuationJobView(open), runJobId: open.jobId };
  }

  if (input.intent === "status") {
    const latest = await dependencies.store.findLatestByTicker(ticker);

    return {
      view: latest === null ? { state: "idle" } : toValuationJobView(latest),
      runJobId: null,
    };
  }

  const instant = dependencies.now();
  const job = queueValuationJob({
    jobId: dependencies.newId(),
    ticker,
    knownAt: instant,
    createdAt: instant,
  });

  try {
    await dependencies.store.insert(job);
  } catch (error) {
    if (error instanceof ValuationJobConflictError) {
      const existing = await dependencies.store.findOpenByTicker(ticker);

      if (existing !== null) {
        return {
          view: toValuationJobView(existing),
          runJobId: existing.jobId,
        };
      }
    }

    throw error;
  }

  return { view: toValuationJobView(job), runJobId: job.jobId };
}

/** Lo que el job dejó publicado después de su corte: otro lo continúa. */
const CONTINUED_GAPS: ReadonlySet<string> = new Set([
  "data_ingested",
  "qualitative_resolved",
]);

export type ValuationJobRunResult = {
  readonly status: "idle" | "completed" | "failed";
  readonly errorName: string | null;
  /**
   * El job encolado que continúa a éste después de bajar datos (`F6-05`) o de
   * una decisión aceptada de la IA (`F6-13`).
   */
  readonly followUpJobId: string | null;
};

/**
 * Evalúa un job reclamado. Si la lectura falla, el job igual termina, con
 * `assessment_failed`, para no dejar el ticker tomado.
 *
 * Un job que bajó datos (`data_ingested`) o dejó una decisión aceptada de la
 * IA (`qualitative_resolved`) se cierra encolando otro del mismo ticker con un
 * corte nuevo, en la misma transacción. El llamador lo corre.
 */
export async function runValuationJob(
  jobId: string,
  dependencies: ValuationJobRunnerDependencies,
): Promise<ValuationJobRunResult> {
  const startedAt = dependencies.now();
  const claimToken = dependencies.newId();
  const claimed = await dependencies.store.claim({
    jobId,
    startedAt,
    claimToken,
    staleBefore: addMilliseconds(startedAt, -VALUATION_JOB_STALE_AFTER_MS),
  });

  if (claimed?.claimToken == null) {
    return { status: "idle", errorName: null, followUpJobId: null };
  }

  const stopHeartbeat =
    dependencies.startHeartbeat?.(async () => {
      // Un latido perdido no corta el trabajo: el cierre cercado decide.
      await dependencies.store
        .beat({ jobId, claimToken, at: dependencies.now() })
        .catch(() => "lost");
    }, VALUATION_JOB_HEARTBEAT_MS) ?? (() => undefined);

  let outcome: ValuationJobOutcome;
  let errorName: string | null = null;

  try {
    outcome = await dependencies.assess(claimed);
  } catch (error) {
    outcome = outcomeForFailure();
    errorName = error instanceof Error ? error.name : typeof error;
  } finally {
    stopHeartbeat();
  }

  const finishedAt = dependencies.now();
  const followUp =
    outcome.gap !== null && CONTINUED_GAPS.has(outcome.gap)
      ? queueValuationJob({
          jobId: dependencies.newId(),
          ticker: claimed.ticker,
          knownAt: finishedAt,
          createdAt: finishedAt,
          followsJobId: jobId,
        })
      : undefined;

  const finished = await dependencies.store.finish({
    jobId,
    claimToken,
    finishedAt,
    outcome,
    followUp,
  });

  if (finished === "lost") {
    return { status: "idle", errorName: null, followUpJobId: null };
  }

  return {
    status: errorName === null ? "completed" : "failed",
    errorName,
    followUpJobId: followUp?.jobId ?? null,
  };
}
