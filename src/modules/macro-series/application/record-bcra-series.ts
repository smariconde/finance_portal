import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import {
  BCRA_MONETARY_PARSER_VERSION,
  BCRA_MONETARY_SOURCE_ID,
  BCRA_OBSERVATIONS_DATASET_ID,
  BCRA_REVISION_WINDOW_VERSION,
  bcraSeriesKey,
  type BcraVariableId,
} from "../domain/bcra-monetary-source";
import {
  basisOf,
  isOpenDefinition,
  type SeriesBasis,
  type SeriesDefinition,
} from "../domain/series-definition";
import {
  checkDefinitionBasis,
  materializeObservationPlan,
  observationWindowStart,
  planObservations,
  type ObservationPlan,
} from "../domain/series-observation";

import type { BcraSourceProvider, FetchedSeries } from "./live-bcra-source";
import type { MacroSeriesRepository } from "./macro-series-repository";

/**
 * Registra las observaciones de una variable (`F9-01`, ADR 0065, decisiones 3 y
 * 4). Una corrida por serie.
 *
 * La primera descarga trae la historia entera; las siguientes, una sola página
 * —los 3.000 puntos más recientes— contra la que se comparan los guardados desde
 * su fecha más vieja (`bcra-revision-window-1.0.0`). `full` vuelve a leer todo.
 */
export type RecordBcraSeriesDependencies = {
  readonly source: BcraSourceProvider;
  readonly repository: MacroSeriesRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly now: () => string;
  readonly newId: () => string;
  readonly full?: boolean;
  /** Destraba el guard de cambio masivo. Lo decide el owner, nunca un default. */
  readonly acceptMassChange?: boolean;
  readonly dryRun?: boolean;
};

export type RecordBcraSeriesOutcome =
  | {
      /** Sin definición vigente no se sabe qué unidad tiene: no se pide nada. */
      readonly status: "definition_not_recorded";
      readonly seriesKey: string;
    }
  | {
      readonly status: "definition_basis_changed";
      readonly seriesKey: string;
      readonly pinned: SeriesBasis;
      readonly current: SeriesBasis;
    }
  | {
      readonly status: "recorded";
      readonly seriesKey: string;
      readonly definition: SeriesDefinition;
      readonly fetched: FetchedSeries;
      readonly plan: ObservationPlan;
      readonly runId: string | null;
      readonly runStatus: string | null;
    };

export async function recordBcraSeries(
  variableId: BcraVariableId,
  dependencies: RecordBcraSeriesDependencies,
): Promise<RecordBcraSeriesOutcome> {
  const {
    source,
    repository,
    ingestionRuns,
    now,
    newId,
    full = false,
    acceptMassChange = false,
    dryRun = false,
  } = dependencies;
  const seriesKey = bcraSeriesKey(variableId);
  const definition =
    (await repository.listSeriesDefinitions(seriesKey)).find(
      isOpenDefinition,
    ) ?? null;

  if (definition === null) {
    return { status: "definition_not_recorded", seriesKey };
  }

  const series = await repository.findSeries(seriesKey);
  const basis = basisOf(definition);
  const basisCheck = checkDefinitionBasis(series?.basis ?? null, basis);

  if (basisCheck.status === "definition_basis_changed") {
    return {
      status: "definition_basis_changed",
      seriesKey,
      pinned: basisCheck.pinned,
      current: basisCheck.current,
    };
  }

  const startedAt = now();
  // La base se fija con la primera descarga: sin ella todavía no hay historia.
  const coverage =
    full || basisCheck.status === "pinned" ? "complete" : "window";
  const fetched = await source.loadSeries(variableId, coverage);
  const windowStartsOn =
    fetched.coverage === "complete"
      ? null
      : observationWindowStart(fetched.points, fetched.rejections);
  const open = await repository.listOpenObservations(seriesKey, windowStartsOn);
  const plan = planObservations({
    seriesKey,
    points: fetched.points,
    rejections: fetched.rejections,
    coverage: fetched.coverage,
    open,
    acceptMassChange,
  });

  const base = {
    status: "recorded" as const,
    seriesKey,
    definition,
    fetched,
    plan,
  };

  if (dryRun) {
    return { ...base, runId: null, runStatus: null };
  }

  const contentHash = computeContentHash({ seriesKey, points: fetched.points });
  const { status, counts } = seriesRunVerdict(plan);
  const runId = newId();
  const finishedAt = now();

  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId,
      sourceId: BCRA_MONETARY_SOURCE_ID,
      datasetId: BCRA_OBSERVATIONS_DATASET_ID,
      parserVersion: BCRA_MONETARY_PARSER_VERSION,
      // La transición: el contenido más el estado guardado que reemplaza.
      idempotencyKey: computeContentHash({
        datasetId: BCRA_OBSERVATIONS_DATASET_ID,
        contentHash,
        supersedes: open.map((observation) => [
          observation.periodOn,
          observation.revision,
        ]),
      }),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: String(variableId),
      selectionVersion: BCRA_REVISION_WINDOW_VERSION,
      // Con la versión, dice desde qué fecha se controlaron revisiones.
      selectionAnchorOn: plan.windowStartsOn,
      status,
      startedAt,
      finishedAt,
      counts,
      contentHash,
      failure: null,
      qualityFlags: [
        "availability_is_observation",
        ...(plan.guard.refused ? ["mass_change_guard"] : []),
        ...(plan.withdrawalsDeferred ? ["withdrawals_deferred"] : []),
        ...(basisCheck.status === "pinned" ? ["basis_pinned"] : []),
        ...(plan.counts.rejected > 0 ? ["rows_rejected"] : []),
      ],
      replayOfRunId: null,
      recordedAt: finishedAt,
    }),
  );

  if (
    (status === "succeeded" || status === "partial") &&
    plan.changes.length > 0
  ) {
    await repository.applyObservations({
      seriesKey,
      basis,
      revisions: materializeObservationPlan(plan, {
        observedAt: fetched.observedAt,
        recordedAt: run.recordedAt,
        ingestionRunId: run.runId,
      }),
    });
  }

  return { ...base, runId: run.runId, runStatus: run.status };
}

/**
 * Estado y conteos de la corrida, con la convención de las demás ingestas:
 * `accepted` son los puntos válidos leídos y `rejected` los que el parser
 * rechazó. Qué fue nuevo, revisado o igual lo dice el plan. Una corrida que no
 * cambia nada es `duplicate` aunque haya rechazos —un `partial` repetiría la
 * clave de idempotencia— y el flag `rows_rejected` lo deja dicho.
 */
export function seriesRunVerdict(plan: ObservationPlan): {
  readonly status: "succeeded" | "partial" | "duplicate" | "quarantined";
  readonly counts: {
    readonly fetched: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly duplicate: number;
  };
} {
  const { fetched, rejected } = plan.counts;

  if (plan.guard.refused) {
    return {
      status: "quarantined",
      counts: { fetched, accepted: 0, rejected: fetched, duplicate: 0 },
    };
  }

  if (plan.changes.length === 0) {
    return {
      status: "duplicate",
      counts: { fetched, accepted: 0, rejected: 0, duplicate: fetched },
    };
  }

  return {
    status: rejected > 0 ? "partial" : "succeeded",
    counts: { fetched, accepted: fetched - rejected, rejected, duplicate: 0 },
  };
}
