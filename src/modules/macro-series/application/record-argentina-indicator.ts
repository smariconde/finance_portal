import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import type { ArgentinaIndicator } from "../domain/argentina-indicator";
import {
  planArgentinaIndicator,
  type ArgentinaIndicatorPlan,
  type FetchedIndicatorPoint,
} from "../domain/plan-argentina-indicator";

import type { ArgentinaIndicatorRepository } from "./argentina-indicator-repository";

/** Revision policy of a declared indicator: the whole history on every run. */
export const ARGENTINA_INDICATOR_SELECTION_VERSION =
  "argentina-indicator-full-history-1.0.0";

export type FetchedIndicatorPoints = {
  readonly points: readonly FetchedIndicatorPoint[];
  readonly observedAt: string;
  readonly requests: number;
  readonly bytes: number;
};

/**
 * One distributor of declared indicators (ADR 0069). The recorder picks it by
 * the indicator's `sourceId`, so a series never silently changes source.
 */
export type ArgentinaIndicatorSource = {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly parserVersion: string;
  load(indicator: ArgentinaIndicator): Promise<FetchedIndicatorPoints>;
};

export type RecordArgentinaIndicatorOutcome = {
  readonly indicatorId: string;
  readonly fetched: FetchedIndicatorPoints;
  readonly plan: ArgentinaIndicatorPlan;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

/**
 * Records one declared indicator as one run. A refused mass change is a
 * `quarantined` run that publishes nothing; the owner decides with
 * `acceptMassChange`, never a default.
 */
export async function recordArgentinaIndicator(
  indicator: ArgentinaIndicator,
  dependencies: {
    readonly sources: readonly ArgentinaIndicatorSource[];
    readonly repository: ArgentinaIndicatorRepository;
    readonly ingestionRuns: IngestionRunRepository;
    readonly now: () => string;
    readonly newId: () => string;
    readonly acceptMassChange?: boolean;
    readonly dryRun?: boolean;
  },
): Promise<RecordArgentinaIndicatorOutcome> {
  const {
    repository,
    ingestionRuns,
    now,
    newId,
    acceptMassChange = false,
    dryRun = false,
  } = dependencies;
  const source = dependencies.sources.find(
    (candidate) => candidate.sourceId === indicator.sourceId,
  );
  if (!source) {
    throw new Error(`source_not_wired: ${indicator.sourceId}`);
  }

  const startedAt = now();
  const fetched = await source.load(indicator);
  const currentDefinition = await repository.currentDefinition(indicator.id);
  const open = await repository.openObservations(indicator.id);
  const runId = newId();
  const recordedAt = now();
  const plan = planArgentinaIndicator({
    indicator,
    currentDefinition,
    open,
    fetched: fetched.points,
    observedAt: fetched.observedAt,
    recordedAt,
    runId,
    acceptMassChange,
  });

  if (dryRun) {
    return {
      indicatorId: indicator.id,
      fetched,
      plan,
      runId: null,
      runStatus: null,
    };
  }

  const contentHash = computeContentHash({
    indicatorId: indicator.id,
    definition: indicator,
    points: fetched.points,
  });
  const { status, counts } = indicatorRunVerdict(plan, fetched.points.length);
  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId,
      sourceId: source.sourceId,
      datasetId: source.datasetId,
      parserVersion: source.parserVersion,
      // The transition: the content plus the open state it replaces.
      idempotencyKey: computeContentHash({
        datasetId: source.datasetId,
        contentHash,
        supersedes: open.map((point) => [point.periodOn, point.revision]),
        definition: currentDefinition?.revision ?? null,
      }),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: indicator.externalId,
      selectionVersion: ARGENTINA_INDICATOR_SELECTION_VERSION,
      selectionAnchorOn: null,
      status,
      startedAt,
      finishedAt: recordedAt,
      counts,
      contentHash,
      failure: null,
      qualityFlags: [
        "availability_is_observation",
        ...(plan.guard.refused ? ["mass_change_guard"] : []),
        ...(plan.definition !== null && !plan.guard.refused
          ? ["definition_recorded"]
          : []),
      ],
      replayOfRunId: null,
      recordedAt,
    }),
  );

  if (status === "succeeded") {
    await repository.apply(plan, indicator.id);
  }

  return {
    indicatorId: indicator.id,
    fetched,
    plan,
    runId: run.runId,
    runStatus: run.status,
  };
}

/**
 * A run that changes neither a point nor the definition is `duplicate`; a
 * refused one is `quarantined` with every fetched point rejected.
 */
export function indicatorRunVerdict(
  plan: ArgentinaIndicatorPlan,
  fetched: number,
): {
  readonly status: "succeeded" | "duplicate" | "quarantined" | "empty";
  readonly counts: {
    readonly fetched: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly duplicate: number;
  };
} {
  if (plan.guard.refused) {
    return {
      status: "quarantined",
      counts: { fetched, accepted: 0, rejected: fetched, duplicate: 0 },
    };
  }
  if (fetched === 0) {
    return {
      status: "empty",
      counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
    };
  }
  if (plan.observations.length === 0 && plan.definition === null) {
    return {
      status: "duplicate",
      counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
    };
  }
  return {
    status: "succeeded",
    counts: { fetched, accepted: fetched, rejected: 0, duplicate: 0 },
  };
}
