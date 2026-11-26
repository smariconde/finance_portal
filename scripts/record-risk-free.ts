import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { ECB_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveEcbSource } from "@/modules/reference-data/application/live-ecb-source";
import { recordReferenceDataset } from "@/modules/reference-data/application/record-reference-datasets";
import {
  DECLARED_RISK_FREE_CURVES,
  ECB_SOURCE_ID,
} from "@/modules/reference-data/domain/risk-free-curves";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getReferenceDatasetRepository } from "@/server/persistence/get-reference-dataset-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra las tasas libres de riesgo por moneda (`F6-55`,
 * [ADR 0087](../docs/architecture/adr/0087-foreign-private-issuers.md)).
 *
 *   pnpm risk-free:record                                   # las curvas declaradas, en seco
 *   pnpm risk-free:record --dataset ecb.eur-aaa-par-10y --apply
 *
 * Una request por curva con sus últimas observaciones. La valuación de un
 * emisor que reporta en EUR la pide sola cuando la release guardada no tiene el
 * día; esto es para correrla a mano.
 */
const { values } = parseArgs({
  options: {
    dataset: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const known = DECLARED_RISK_FREE_CURVES.map((curve) => curve.datasetId);
const requested = values.dataset.length === 0 ? known : values.dataset;

for (const datasetId of requested) {
  if (!known.includes(datasetId)) {
    console.error(
      `${datasetId}: no es una curva declarada (${known.join(", ")}).`,
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
  ECB_SOURCE_ID,
  requested.length,
  new Date().toISOString(),
);

if (verdict.status !== "allowed") {
  console.error(describeSourceRefusal(ECB_SOURCE_ID, verdict));
  process.exit(2);
}

const source = createLiveEcbSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(ECB_REQUEST_PACING),
});
const repository = getReferenceDatasetRepository();
const ingestionRuns = getIngestionRunRepository();

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");

for (const datasetId of requested) {
  const curve = DECLARED_RISK_FREE_CURVES.find(
    (candidate) => candidate.datasetId === datasetId,
  )!;
  const outcome = await recordReferenceDataset(curve, {
    source,
    sourceId: ECB_SOURCE_ID,
    repository,
    ingestionRuns,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    dryRun: DRY_RUN,
  });

  console.log(`\n── ${outcome.datasetId}`);
  log("último dato", outcome.publishedLabel ?? "—");
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
