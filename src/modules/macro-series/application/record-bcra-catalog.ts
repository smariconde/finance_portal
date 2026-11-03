import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import {
  BCRA_MONETARY_PROFILE,
  type BcraSourceProfile,
} from "../domain/bcra-source-profile";
import {
  catalogPlanChanges,
  definitionContentHash,
  definitionContentOf,
  planCatalog,
  type CatalogPlan,
} from "../domain/series-definition";

import type { BcraSourceProvider, FetchedCatalog } from "./live-bcra-source";
import type { MacroSeriesRepository } from "./macro-series-repository";

/**
 * Registra el catálogo y la metodología de Estadísticas Monetarias v4 (`F9-01`,
 * ADR 0065, decisión 5). Una corrida por catálogo: nueve requests, una sola
 * observación.
 *
 * El plan se calcula contra las definiciones vigentes: una variable igual no
 * escribe nada, una distinta supersede a la suya y una que el catálogo dejó de
 * listar se cierra —salvo que fueran demasiadas, que es lo que el guard frena—.
 */
export type RecordBcraCatalogDependencies = {
  readonly source: BcraSourceProvider;
  readonly repository: MacroSeriesRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly now: () => string;
  readonly newId: () => string;
  /** Destraba el guard de bajas masivas. Lo decide el owner, nunca un default. */
  readonly acceptWithdrawals?: boolean;
  /** En seco no se registra corrida ni se escribe fila. */
  readonly dryRun?: boolean;
  /** La API del BCRA: por defecto, Estadísticas Monetarias (ADR 0067). */
  readonly profile?: BcraSourceProfile;
};

export type RecordBcraCatalogOutcome = {
  readonly fetched: FetchedCatalog;
  readonly plan: CatalogPlan;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

export async function recordBcraCatalog(
  dependencies: RecordBcraCatalogDependencies,
): Promise<RecordBcraCatalogOutcome> {
  const {
    source,
    repository,
    ingestionRuns,
    now,
    newId,
    acceptWithdrawals = false,
    dryRun = false,
    profile = BCRA_MONETARY_PROFILE,
  } = dependencies;
  const startedAt = now();
  const fetched = await source.loadCatalog();
  const current = await repository.listOpenDefinitions(profile.sourceId);
  const runId = newId();
  const plan = planCatalog({
    entries: fetched.entries,
    methodologies: fetched.methodologies,
    rejections: fetched.rejections,
    current,
    observedAt: fetched.observedAt,
    recordedAt: now(),
    sourceDocumentId: fetched.sourceDocumentId,
    parserVersion: profile.parserVersion,
    ingestionRunId: runId,
    acceptWithdrawals,
    newId,
    profile,
  });

  if (dryRun) {
    return { fetched, plan, runId: null, runStatus: null };
  }

  // El contenido es el catálogo definido —sin último valor ni última fecha—,
  // así que dos días sin cambios de definición dan el mismo hash.
  const contentHash = computeContentHash(
    fetched.entries
      .map((entry) =>
        definitionContentHash(
          definitionContentOf(
            entry,
            fetched.methodologies.get(entry.variableId) ?? null,
            profile,
          ),
        ),
      )
      .sort(),
  );
  const { status, counts } = catalogRunVerdict(plan, fetched);
  const finishedAt = now();

  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId,
      sourceId: profile.sourceId,
      datasetId: profile.catalogDatasetId,
      parserVersion: profile.parserVersion,
      // La clave identifica la **transición**: el mismo catálogo que vuelve
      // después de otro es un cambio, no un replay del primero.
      idempotencyKey: computeContentHash({
        datasetId: profile.catalogDatasetId,
        contentHash,
        supersedes: current.map((definition) => definition.definitionId).sort(),
      }),
      requestedAsOf: null,
      requestedVintage: null,
      cursor: null,
      nextCursor: null,
      subjectKey: null,
      selectionVersion: null,
      selectionAnchorOn: null,
      status,
      startedAt,
      finishedAt,
      counts,
      contentHash,
      failure: null,
      qualityFlags: [
        // La vigencia es la observación: el catálogo no fecha lo que publica.
        "availability_is_observation",
        ...(plan.guard.refused ? ["withdrawal_guard"] : []),
        ...(plan.withdrawalsDeferred ? ["withdrawals_deferred"] : []),
        ...(plan.methodologyMissing > 0 ? ["methodology_missing"] : []),
        ...(fetched.rejections.length > 0 ? ["rows_rejected"] : []),
      ],
      replayOfRunId: null,
      recordedAt: finishedAt,
    }),
  );

  if (
    (status === "succeeded" || status === "partial") &&
    catalogPlanChanges(plan) > 0
  ) {
    await repository.applyCatalogPlan(plan);
  }

  return { fetched, plan, runId: run.runId, runStatus: run.status };
}

/** Misma convención que las observaciones: `accepted` son las filas válidas leídas. */
export function catalogRunVerdict(
  plan: CatalogPlan,
  fetched: Pick<FetchedCatalog, "entries" | "rejections">,
): {
  readonly status: "succeeded" | "partial" | "duplicate" | "quarantined";
  readonly counts: {
    readonly fetched: number;
    readonly accepted: number;
    readonly rejected: number;
    readonly duplicate: number;
  };
} {
  const rejected = fetched.rejections.length;
  const total = fetched.entries.length + rejected;

  if (plan.guard.refused) {
    return {
      status: "quarantined",
      counts: { fetched: total, accepted: 0, rejected: total, duplicate: 0 },
    };
  }

  if (catalogPlanChanges(plan) === 0) {
    // Sin cambios no publica nada, aunque haya filas rechazadas: un `partial`
    // repetiría la clave de idempotencia de la corrida anterior.
    return {
      status: "duplicate",
      counts: { fetched: total, accepted: 0, rejected: 0, duplicate: total },
    };
  }

  return {
    status: rejected > 0 ? "partial" : "succeeded",
    counts: {
      fetched: total,
      accepted: fetched.entries.length,
      rejected,
      duplicate: 0,
    },
  };
}
