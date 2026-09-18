import {
  refreshCheckSchema,
  refreshStateKeySchema,
  refreshStateListQuerySchema,
  refreshStateSchema,
  type RefreshState,
  type RefreshStateStore,
} from "../application/refresh-state-store";

/**
 * Doble de test de la marca de agua del refresh. Aplica las mismas reglas que
 * PostgreSQL —una fila por sujeto, la marca sólo la mueve `record`, y un sondeo
 * viejo no pisa a uno más nuevo— para que el contrato compartido pruebe una sola
 * semántica.
 */
export function createInMemoryRefreshStateStore(
  seed: readonly RefreshState[] = [],
): RefreshStateStore {
  const keyOf = (key: {
    sourceId: string;
    datasetId: string;
    subjectKey: string;
  }) => `${key.sourceId}|${key.datasetId}|${key.subjectKey}`;
  const stored = new Map<string, RefreshState>(
    seed.map((state) => {
      const parsed = refreshStateSchema.parse(state);
      return [keyOf(parsed), parsed];
    }),
  );

  return {
    storage: "in-memory-fixture",
    async find(key) {
      return stored.get(keyOf(refreshStateKeySchema.parse(key))) ?? null;
    },
    async list(query) {
      const parsedQuery = refreshStateListQuerySchema.parse(query);

      return [...stored.values()]
        .filter(
          (state) =>
            state.sourceId === parsedQuery.sourceId &&
            state.datasetId === parsedQuery.datasetId,
        )
        .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey))
        .slice(0, parsedQuery.limit);
    },
    async record(state) {
      const parsed = refreshStateSchema.parse(state);
      const current = stored.get(keyOf(parsed));

      // Un sondeo más viejo que el último no pisa la marca: la escritura tardía
      // de un proceso que quedó atrás no retrocede lo que otro ya sabía.
      if (
        current !== undefined &&
        parsed.lastCheckedAt < current.lastCheckedAt
      ) {
        return current;
      }

      stored.set(keyOf(parsed), parsed);

      return parsed;
    },
    async touch(check) {
      const parsed = refreshCheckSchema.parse(check);
      const current = stored.get(keyOf(parsed));

      if (current === undefined) {
        return null;
      }

      if (parsed.checkedAt < current.lastCheckedAt) {
        return current;
      }

      const next = refreshStateSchema.parse({
        ...current,
        probeVersion: parsed.probeVersion,
        lastCheckedAt: parsed.checkedAt,
        probeRunId: parsed.probeRunId,
        updatedAt: parsed.checkedAt,
      });

      stored.set(keyOf(parsed), next);

      return next;
    },
  };
}
