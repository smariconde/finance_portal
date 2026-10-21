import {
  valuationTickerSchema,
  type ValuationJob,
  type ValuationJobView,
} from "../domain/valuation-job";
import {
  compareValuationRuns,
  VALUATION_RUN_COMPARISON_VERSION,
  type ValuationRunComparison,
} from "../domain/valuation-run-comparison";
import type { ValuationRunRepository } from "./valuation-run-repository";
import {
  VALUATION_HISTORY_LIMIT,
  type ValuationJobStore,
} from "./valuation-job-store";

/**
 * Historial de corridas de un ticker (`F6-02`,
 * [ADR 0047](../../../../docs/architecture/adr/0047-valuation-run-history.md)).
 *
 * Los jobs terminados, el más nuevo primero, y para cada uno que registró una
 * corrida qué cambió respecto de la anterior que también registró una. Sólo
 * lee: refrescar es volver a encolar, y `valuation_runs` es append-only, así
 * que nada se sobrescribe.
 *
 * La vista son códigos y fechas. No lleva IDs ni valores: el valor es `F6-03`.
 */
export type ValuationHistoryComparison =
  { readonly kind: "first_run" } | ValuationRunComparison;

export type ValuationHistoryEntry = {
  readonly knownAt: string;
  readonly finishedAt: string | null;
  readonly gap: ValuationJob["gap"];
  readonly snapshotGap: ValuationJob["snapshotGap"];
  readonly method: ValuationJob["method"];
  readonly rigor: ValuationJob["rigor"];
  readonly runStatus: ValuationJob["runStatus"];
  readonly ruleVersion: ValuationJob["ruleVersion"];
  /** `null` cuando el job no registró corrida. */
  readonly comparison: ValuationHistoryComparison | null;
};

export type ValuationHistoryView =
  | Extract<ValuationJobView, { state: "unavailable" }>
  | {
      readonly state: "history";
      readonly ticker: string;
      readonly comparisonVersion: typeof VALUATION_RUN_COMPARISON_VERSION;
      readonly limit: number;
      readonly entries: readonly ValuationHistoryEntry[];
    };

export async function readValuationHistory(
  input: { readonly ticker: string },
  dependencies: {
    readonly jobs: Pick<ValuationJobStore, "listCompletedByTicker">;
    readonly runs: Pick<ValuationRunRepository, "findById">;
  },
): Promise<ValuationHistoryView> {
  const ticker = valuationTickerSchema.parse(input.ticker);
  const jobs = await dependencies.jobs.listCompletedByTicker(
    ticker,
    VALUATION_HISTORY_LIMIT,
  );
  const runIds = [
    ...new Set(
      jobs.flatMap((job) =>
        job.valuationRunId === null ? [] : [job.valuationRunId],
      ),
    ),
  ];
  const runs = new Map(
    (
      await Promise.all(
        runIds.map((runId) => dependencies.runs.findById(runId)),
      )
    ).flatMap((run) => (run === null ? [] : [[run.valuationRunId, run]])),
  );

  const entries = jobs.map((job, index): ValuationHistoryEntry => {
    const run =
      job.valuationRunId === null ? undefined : runs.get(job.valuationRunId);
    let comparison: ValuationHistoryComparison | null = null;

    if (run !== undefined) {
      const previous = jobs
        .slice(index + 1)
        .map((older) =>
          older.valuationRunId === null
            ? undefined
            : runs.get(older.valuationRunId),
        )
        .find((older) => older !== undefined);

      comparison =
        previous === undefined
          ? { kind: "first_run" }
          : compareValuationRuns(previous, run);
    }

    return {
      knownAt: job.knownAt,
      finishedAt: job.finishedAt,
      gap: job.gap,
      snapshotGap: job.snapshotGap,
      method: job.method,
      rigor: job.rigor,
      runStatus: job.runStatus,
      ruleVersion: job.ruleVersion,
      comparison,
    };
  });

  return {
    state: "history",
    ticker,
    comparisonVersion: VALUATION_RUN_COMPARISON_VERSION,
    limit: VALUATION_HISTORY_LIMIT,
    entries,
  };
}
