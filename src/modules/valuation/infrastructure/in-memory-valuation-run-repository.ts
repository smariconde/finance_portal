import {
  toReplayKey,
  valuationReplayKeySchema,
  valuationRunListQuerySchema,
  valuationRunWindowQuerySchema,
  VALUED_RUN_STATUSES,
  ValuationRunWindowLimitError,
  type ValuationReplayKey,
  type ValuationRunRepository,
} from "../application/valuation-run-repository";
import {
  storedValuationRunSchema as valuationRunSchema,
  type StoredValuationRun as ValuationRun,
} from "../domain/stored-valuation-run";

/**
 * Almacén en memoria del modo demo: la demo no abre PostgreSQL, así que sus
 * corridas viven en el proceso. Mantiene las mismas invariantes que el
 * repositorio personal —append-only e idempotencia por clave de replay— para
 * que el aislamiento de modos no cambie la semántica observada (`TM-04`).
 */
export function createInMemoryValuationRunRepository(
  seed: readonly ValuationRun[] = [],
): ValuationRunRepository {
  const stored: ValuationRun[] = seed.map((run) =>
    valuationRunSchema.parse(run),
  );

  function findStored(key: ValuationReplayKey): ValuationRun | null {
    return (
      stored.find(
        (run) =>
          run.inputHash === key.inputHash &&
          run.engineVersion === key.engineVersion &&
          run.methodologyVersion === key.methodologyVersion,
      ) ?? null
    );
  }

  return {
    storage: "in-memory-fixture",
    async record(candidate) {
      const run = valuationRunSchema.parse(candidate);
      const existing = findStored(toReplayKey(run));

      if (existing !== null) {
        return existing;
      }

      stored.push(run);

      return run;
    },
    async findByReplayKey(key) {
      return findStored(valuationReplayKeySchema.parse(key));
    },
    async findById(valuationRunId) {
      return (
        stored.find((run) => run.valuationRunId === valuationRunId) ?? null
      );
    },
    async list(query) {
      const parsedQuery = valuationRunListQuerySchema.parse(query);

      return stored
        .filter(
          (run) =>
            run.subject.legalEntityId === parsedQuery.legalEntityId &&
            (parsedQuery.securityId === undefined ||
              run.subject.securityId === parsedQuery.securityId),
        )
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
        .slice(0, parsedQuery.limit);
    },
    async listLatestInWindow(query) {
      const parsedQuery = valuationRunWindowQuerySchema.parse(query);
      const latest = new Map<string, ValuationRun>();

      for (const run of stored) {
        if (
          run.asOf < parsedQuery.from ||
          run.asOf > parsedQuery.to ||
          !parsedQuery.methods.includes(run.method) ||
          !(VALUED_RUN_STATUSES as readonly string[]).includes(run.status)
        ) {
          continue;
        }

        const current = latest.get(run.subject.legalEntityId);
        if (
          current === undefined ||
          run.asOf > current.asOf ||
          (run.asOf === current.asOf && run.recordedAt > current.recordedAt)
        ) {
          latest.set(run.subject.legalEntityId, run);
        }
      }

      if (latest.size > parsedQuery.limit) {
        throw new ValuationRunWindowLimitError(
          "More companies were valued in the window than the read allows.",
        );
      }

      return [...latest.values()];
    },
  };
}
