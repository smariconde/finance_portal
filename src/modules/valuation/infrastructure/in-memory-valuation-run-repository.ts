import {
  toReplayKey,
  valuationReplayKeySchema,
  valuationRunListQuerySchema,
  type ValuationReplayKey,
  type ValuationRunRepository,
} from "../application/valuation-run-repository";
import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";

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
  };
}
