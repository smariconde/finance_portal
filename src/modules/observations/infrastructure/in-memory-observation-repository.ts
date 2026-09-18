import {
  MAX_REVISION_GROUPS_PER_LOOKUP,
  observationListQuerySchema,
  observationPruneRequestSchema,
  publishedSubjectsQuerySchema,
  type ObservationPublication,
  type ObservationRepository,
  type PublishedSubject,
} from "../application/observation-repository";
import { observationSchema, type Observation } from "../domain/observation";
import {
  isPruned,
  observationPruneCountsSchema,
  observationPrunePlanSchema,
  observationPruneSchema,
  type ObservationPrune,
  type ObservationPruneCounts,
  type ObservationPrunePlan,
} from "../domain/observation-prune";

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

function countsOf(
  deleted: readonly Observation[],
  kept: readonly Observation[],
): ObservationPruneCounts {
  const ends = deleted.map((observation) => observation.asOf).sort();

  return observationPruneCountsSchema.parse({
    deleted: deleted.length,
    kept: kept.length,
    deletedMinAsOf: ends.at(0) ?? null,
    deletedMaxAsOf: ends.at(-1) ?? null,
  });
}

/**
 * Almacén en memoria del modo demo: la demo no abre PostgreSQL, así que sus
 * observaciones viven en el proceso. Mantiene las mismas invariantes que el
 * repositorio personal —una revisión por número, una sola vigente por cadena y
 * publicación atómica— para que el aislamiento de modos no cambie la semántica
 * observada (`TM-04`).
 */
export function createInMemoryObservationRepository(
  seed: readonly Observation[] = [],
): ObservationRepository {
  const stored: Observation[] = seed.map((observation) =>
    observationSchema.parse(observation),
  );
  const prunes: ObservationPrune[] = [];

  /** Las filas del sujeto que ese plan alcanza, borradas o conservadas. */
  function partition(plan: ObservationPrunePlan): {
    deleted: Observation[];
    kept: Observation[];
  } {
    const deleted: Observation[] = [];
    const kept: Observation[] = [];

    for (const observation of stored) {
      if (
        observation.sourceId !== plan.sourceId ||
        observation.datasetId !== plan.datasetId ||
        observation.subjectType !== plan.subjectType ||
        observation.subjectId !== plan.subjectId
      ) {
        continue;
      }

      (isPruned(plan, observation) ? deleted : kept).push(observation);
    }

    return { deleted, kept };
  }

  function groupOf(revisionGroupId: string): Observation[] {
    return stored
      .filter((observation) => observation.revisionGroupId === revisionGroupId)
      .sort((left, right) => left.revisionNumber - right.revisionNumber);
  }

  return {
    storage: "in-memory-fixture",
    async findLatestRevision(revisionGroupId) {
      return groupOf(revisionGroupId).at(-1) ?? null;
    },
    async listRevisionGroups(revisionGroupIds) {
      if (revisionGroupIds.length > MAX_REVISION_GROUPS_PER_LOOKUP) {
        throw new RangeError(
          `At most ${MAX_REVISION_GROUPS_PER_LOOKUP} revision groups per lookup.`,
        );
      }

      const wanted = new Set(revisionGroupIds);

      return stored
        .filter((observation) => wanted.has(observation.revisionGroupId))
        .sort(
          (left, right) =>
            left.revisionGroupId.localeCompare(right.revisionGroupId) ||
            left.revisionNumber - right.revisionNumber,
        );
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
    async countPruneTargets(plan) {
      const { deleted, kept } = partition(
        observationPrunePlanSchema.parse(plan),
      );

      return countsOf(deleted, kept);
    },
    async prune(request) {
      const parsedRequest = observationPruneRequestSchema.parse(request);
      const { deleted, kept } = partition(parsedRequest.plan);
      const counts = countsOf(deleted, kept);
      const doomed = new Set(
        deleted.map((observation) => observation.observationId),
      );

      const record = observationPruneSchema.parse({
        pruneId: parsedRequest.pruneId,
        ruleVersion: parsedRequest.ruleVersion,
        sourceId: parsedRequest.plan.sourceId,
        datasetId: parsedRequest.plan.datasetId,
        subjectType: parsedRequest.plan.subjectType,
        subjectId: parsedRequest.plan.subjectId,
        selectionVersion: parsedRequest.selectionVersion,
        selectionAnchorOn: parsedRequest.selectionAnchorOn,
        anchorRunId: parsedRequest.anchorRunId,
        periodsEndingBefore: parsedRequest.plan.periodsEndingBefore,
        evidencePeriodsEndingBefore:
          parsedRequest.plan.evidencePeriodsEndingBefore,
        evidenceConcepts: parsedRequest.plan.evidenceConcepts,
        deletedCount: counts.deleted,
        keptCount: counts.kept,
        deletedMinAsOf: counts.deletedMinAsOf,
        deletedMaxAsOf: counts.deletedMaxAsOf,
        actor: parsedRequest.actor,
        reason: parsedRequest.reason,
        executedAt: parsedRequest.executedAt,
      });

      const survivors = stored.filter(
        (observation) => !doomed.has(observation.observationId),
      );

      stored.length = 0;
      stored.push(...survivors);
      prunes.push(record);

      return record;
    },
    async listPublishedSubjects(query) {
      const parsedQuery = publishedSubjectsQuerySchema.parse(query);
      const bySubject = new Map<string, PublishedSubject>();

      for (const observation of stored) {
        if (
          observation.sourceId !== parsedQuery.sourceId ||
          observation.datasetId !== parsedQuery.datasetId
        ) {
          continue;
        }

        const key = `${observation.subjectType}|${observation.subjectId}`;
        const seen = bySubject.get(key);

        bySubject.set(key, {
          subjectType: observation.subjectType,
          subjectId: observation.subjectId,
          observations: (seen?.observations ?? 0) + 1,
          latestAvailableAt:
            seen === undefined ||
            observation.availableAt > seen.latestAvailableAt
              ? observation.availableAt
              : seen.latestAvailableAt,
        });
      }

      return [...bySubject.values()]
        .sort(
          (left, right) =>
            left.subjectType.localeCompare(right.subjectType) ||
            left.subjectId.localeCompare(right.subjectId),
        )
        .slice(0, parsedQuery.limit);
    },
    async listPrunes(subjectType, subjectId) {
      return prunes
        .filter(
          (prune) =>
            prune.subjectType === subjectType && prune.subjectId === subjectId,
        )
        .sort((left, right) => right.executedAt.localeCompare(left.executedAt));
    },
  };
}
