import {
  ingestionRunListQuerySchema,
  type IngestionRunRepository,
} from "@/modules/ingestion/application/ingestion-run-repository";
import {
  ingestionRunSchema,
  isPublishableStatus,
  type IngestionRun,
} from "@/modules/ingestion/domain/ingestion-run";

export class DuplicateIngestionRunError extends Error {
  constructor() {
    super(
      "A publishable ingestion run already exists for this idempotency key.",
    );
    this.name = "DuplicateIngestionRunError";
  }
}

/**
 * Almacén efímero en memoria para el modo demo: la demo no abre PostgreSQL, así
 * que sus corridas viven en el proceso y desaparecen con él. Mantiene las mismas
 * invariantes append-only que el repositorio personal para que el aislamiento de
 * modos no cambie la semántica observada.
 */
export function createInMemoryIngestionRunRepository(
  seed: readonly IngestionRun[] = [],
): IngestionRunRepository {
  const runs: IngestionRun[] = seed.map((run) => ingestionRunSchema.parse(run));

  return {
    storage: "in-memory-fixture",
    async findByIdempotencyKey(idempotencyKey) {
      return (
        runs
          .filter((run) => run.idempotencyKey === idempotencyKey)
          .sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt),
          )[0] ?? null
      );
    },
    async findLatestPublishable(sourceId, datasetId) {
      return (
        runs
          .filter(
            (run) =>
              run.sourceId === sourceId &&
              run.datasetId === datasetId &&
              isPublishableStatus(run.status),
          )
          .sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt),
          )[0] ?? null
      );
    },
    async list(query) {
      const parsedQuery = ingestionRunListQuerySchema.parse(query);

      return runs
        .filter(
          (run) =>
            run.sourceId === parsedQuery.sourceId &&
            (parsedQuery.datasetId === undefined ||
              run.datasetId === parsedQuery.datasetId),
        )
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, parsedQuery.limit);
    },
    async append(run) {
      const parsedRun = ingestionRunSchema.parse(run);

      // Espeja el índice único parcial de PostgreSQL: a lo sumo una corrida
      // publicable por clave de idempotencia; los reintentos fallidos, vacíos o
      // en cuarentena sí se acumulan como evidencia (`TM-16`).
      if (
        isPublishableStatus(parsedRun.status) &&
        runs.some(
          (stored) =>
            stored.idempotencyKey === parsedRun.idempotencyKey &&
            isPublishableStatus(stored.status),
        )
      ) {
        throw new DuplicateIngestionRunError();
      }

      runs.push(parsedRun);
      return parsedRun;
    },
  };
}
