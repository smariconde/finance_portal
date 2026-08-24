import {
  observationListQuerySchema,
  type ObservationPublication,
  type ObservationRepository,
} from "../application/observation-repository";
import { observationSchema, type Observation } from "../domain/observation";

export class DuplicateRevisionError extends Error {
  constructor(revisionGroupId: string, revisionNumber: number) {
    super(
      `Revision ${revisionNumber} already exists for revision group ${revisionGroupId}.`,
    );
    this.name = "DuplicateRevisionError";
  }
}

export class ConcurrentRevisionError extends Error {
  constructor(revisionGroupId: string) {
    super(`More than one revision would stay current for ${revisionGroupId}.`);
    this.name = "ConcurrentRevisionError";
  }
}

/**
 * Almacén en memoria del modo demo: la demo no abre PostgreSQL, así que sus
 * observaciones viven en el proceso. Mantiene las mismas invariantes que el
 * repositorio personal —una revisión por número, una sola vigente por cadena y
 * publicación atómica— para que el aislamiento de modos no cambie la semántica
 * observada (`TM-04`).
 */
export function createDemoObservationRepository(
  seed: readonly Observation[] = [],
): ObservationRepository {
  const stored: Observation[] = seed.map((observation) =>
    observationSchema.parse(observation),
  );

  function groupOf(revisionGroupId: string): Observation[] {
    return stored
      .filter((observation) => observation.revisionGroupId === revisionGroupId)
      .sort((left, right) => left.revisionNumber - right.revisionNumber);
  }

  return {
    storage: "demo-fixture",
    async findLatestRevision(revisionGroupId) {
      return groupOf(revisionGroupId).at(-1) ?? null;
    },
    async listByRevisionGroup(revisionGroupId) {
      return groupOf(revisionGroupId);
    },
    async list(query) {
      const parsedQuery = observationListQuerySchema.parse(query);
      const metricIds =
        parsedQuery.metricIds === undefined
          ? null
          : new Set(parsedQuery.metricIds);

      return stored
        .filter(
          (observation) =>
            observation.subjectType === parsedQuery.subjectType &&
            observation.subjectId === parsedQuery.subjectId &&
            (metricIds === null || metricIds.has(observation.metricId)),
        )
        .sort(
          (left, right) =>
            left.revisionGroupId.localeCompare(right.revisionGroupId) ||
            left.revisionNumber - right.revisionNumber,
        )
        .slice(0, parsedQuery.limit);
    },
    async publish(publication: ObservationPublication) {
      const incoming = publication.observations.map((observation) =>
        observationSchema.parse(observation),
      );

      // Validación completa antes de mutar: una publicación parcial dejaría la
      // cadena de revisiones inconsistente.
      for (const observation of incoming) {
        if (
          stored.some(
            (existing) =>
              existing.revisionGroupId === observation.revisionGroupId &&
              existing.revisionNumber === observation.revisionNumber,
          )
        ) {
          throw new DuplicateRevisionError(
            observation.revisionGroupId,
            observation.revisionNumber,
          );
        }
      }

      const superseded = new Map(
        publication.supersessions.map((supersession) => [
          supersession.observationId,
          supersession.supersededAt,
        ]),
      );

      const next = stored.map((observation) => {
        const supersededAt = superseded.get(observation.observationId);

        return supersededAt === undefined || observation.supersededAt !== null
          ? observation
          : observationSchema.parse({ ...observation, supersededAt });
      });

      const merged = [...next, ...incoming];

      for (const observation of incoming) {
        const currentCount = merged.filter(
          (candidate) =>
            candidate.revisionGroupId === observation.revisionGroupId &&
            candidate.supersededAt === null,
        ).length;

        if (currentCount > 1) {
          throw new ConcurrentRevisionError(observation.revisionGroupId);
        }
      }

      stored.length = 0;
      stored.push(...merged);

      return incoming;
    },
  };
}
