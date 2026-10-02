import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import {
  DAMODARAN_SOURCE_ID,
  type DamodaranDataset,
} from "../domain/damodaran-datasets";
import {
  isOpenRelease,
  planReferenceRelease,
  releaseContent,
  type ReleasePlan,
} from "../domain/reference-release";

import type { ReferenceDatasetRepository } from "./reference-dataset-repository";
import type { ReferenceSourceProvider } from "./live-damodaran-source";

/**
 * Registra la release vigente de un dataset de Damodaran (`F3-04`, ADR 0032).
 *
 * Un dataset por llamada: cada página es una request y una corrida, y una página
 * caída no tiene por qué impedir registrar las otras. El plan se calcula contra
 * la release guardada: la misma publicación no escribe nada.
 */
export type RecordReferenceDatasetDependencies = {
  readonly source: ReferenceSourceProvider;
  readonly repository: ReferenceDatasetRepository;
  readonly ingestionRuns: IngestionRunRepository;
  readonly now: () => string;
  readonly newId: () => string;
  /** En seco no se registra corrida ni se escribe fila. */
  readonly dryRun?: boolean;
};

export type RecordReferenceDatasetOutcome = {
  readonly datasetId: string;
  readonly publishedLabel: string | null;
  readonly rows: number;
  readonly rejections: number;
  readonly byteLength: number;
  readonly observedAt: string;
  readonly plan: ReleasePlan;
  readonly runId: string | null;
  readonly runStatus: string | null;
};

export async function recordReferenceDataset(
  dataset: DamodaranDataset,
  dependencies: RecordReferenceDatasetDependencies,
): Promise<RecordReferenceDatasetOutcome> {
  const {
    source,
    repository,
    ingestionRuns,
    now,
    newId,
    dryRun = false,
  } = dependencies;
  const startedAt = now();
  const fetched = await source.load(dataset);
  const { publication } = fetched;
  const releases = await repository.listReleases(dataset.datasetId);
  const open = releases.filter(isOpenRelease);

  if (open.length > 1) {
    throw new Error(`${dataset.datasetId} has more than one open release`);
  }

  const current = open[0] ?? null;
  const contentHash = computeContentHash(
    releaseContent(publication.datasetId, publication.rows),
  );
  const runId = newId();
  const plan = planReferenceRelease({
    publication,
    current,
    observedAt: fetched.fetchedAt,
    recordedAt: now(),
    sourceId: DAMODARAN_SOURCE_ID,
    sourceDocumentId: fetched.url,
    ingestionRunId: runId,
    contentHash,
    newId,
  });

  const base = {
    datasetId: dataset.datasetId,
    publishedLabel: publication.publishedLabel,
    rows: publication.rows.length,
    rejections: publication.rejections.length,
    byteLength: fetched.byteLength,
    observedAt: fetched.fetchedAt,
    plan,
  };

  if (dryRun) {
    return { ...base, runId: null, runStatus: null };
  }

  const rows = publication.rows.length;
  const rejected = publication.rejections.length;
  const status =
    plan.status === "unchanged"
      ? "duplicate"
      : rejected > 0
        ? "partial"
        : "succeeded";
  const finishedAt = now();

  const run = await ingestionRuns.append(
    ingestionRunSchema.parse({
      runId,
      sourceId: DAMODARAN_SOURCE_ID,
      datasetId: dataset.datasetId,
      parserVersion: publication.parserVersion,
      // La clave identifica la **transición**: el mismo contenido que vuelve
      // después de otro es una release nueva, no un replay de la primera.
      idempotencyKey: computeContentHash({
        contentHash,
        supersedes: current?.releaseId ?? null,
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
      counts:
        status === "duplicate"
          ? {
              fetched: rows + rejected,
              accepted: 0,
              rejected: 0,
              duplicate: rows + rejected,
            }
          : {
              fetched: rows + rejected,
              accepted: rows,
              rejected,
              duplicate: 0,
            },
      contentHash,
      failure: null,
      // La vigencia es la observación, no la fecha que la página escribe.
      qualityFlags: ["availability_is_observation"],
      replayOfRunId:
        plan.status === "unchanged" ? plan.current.ingestionRunId : null,
      recordedAt: finishedAt,
    }),
  );

  if (plan.status === "opened") {
    await repository.applyReleasePlan(plan);
  }

  return { ...base, runId: run.runId, runStatus: run.status };
}
