import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { DAMODARAN_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveDamodaranSource } from "@/modules/reference-data/application/live-damodaran-source";
import { recordReferenceDataset } from "@/modules/reference-data/application/record-reference-datasets";
import {
  DAMODARAN_DATASETS,
  DAMODARAN_SOURCE_ID,
} from "@/modules/reference-data/domain/damodaran-datasets";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra los datasets de Damodaran que usa el costo de capital
 * ([ADR 0032](../docs/architecture/adr/0032-damodaran-reference-datasets.md)).
 *
 *   pnpm damodaran:record                                     # las cuatro páginas, en seco
 *   pnpm damodaran:record --dataset damodaran.betas-us --apply
 *   pnpm damodaran:record --apply
 *
 * Una request por página. Se guardan las filas normalizadas, nunca la página; la
 * misma publicación no escribe nada, y una con otro contenido supersede a la
 * vigente en la observación.
 */
const { values } = parseArgs({
  options: {
    dataset: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const known = DAMODARAN_DATASETS.map((dataset) => dataset.datasetId);
const requested = values.dataset.length === 0 ? known : values.dataset;

for (const datasetId of requested) {
  if (!known.includes(datasetId)) {
    console.error(
      `${datasetId}: no es un dataset declarado (${known.join(", ")}).`,
    );
    process.exit(2);
  }
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const verdict = await checkSourceBudget(
  getSourceBudgetStore(),
  DAMODARAN_SOURCE_ID,
  requested.length,
  new Date().toISOString(),
);

if (verdict.status !== "allowed") {
  console.error(describeSourceRefusal(DAMODARAN_SOURCE_ID, verdict));
  process.exit(2);
}

const source = createLiveDamodaranSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(DAMODARAN_REQUEST_PACING),
});
const repository = getReferenceDatasetRepository();
const ingestionRuns = getIngestionRunRepository();

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");

for (const datasetId of requested) {
  const dataset = DAMODARAN_DATASETS.find(
    (candidate) => candidate.datasetId === datasetId,
  )!;
  const outcome = await recordReferenceDataset(dataset, {
    source,
    repository,
    ingestionRuns,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    dryRun: DRY_RUN,
  });

  console.log(`\n── ${outcome.datasetId}`);
  log("publicado como", outcome.publishedLabel ?? "sin fecha en la página");
  log("observado", outcome.observedAt);
  log("filas", `${outcome.rows} · rechazadas ${outcome.rejections}`);
  log("bytes", outcome.byteLength);
  log(
    "plan",
    outcome.plan.status === "unchanged"
      ? "sin cambios: la release vigente ya tiene este contenido"
      : outcome.plan.supersedes === null
        ? "abre la primera release"
        : "abre una release nueva y supersede la vigente",
  );
  if (outcome.runId !== null) {
    log("corrida", `${outcome.runId} · ${outcome.runStatus}`);
  }
}
