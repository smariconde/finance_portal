import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { BCRA_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveBcraSource } from "@/modules/macro-series/application/live-bcra-source";
import { recordBcraCatalog } from "@/modules/macro-series/application/record-bcra-catalog";
import {
  BCRA_MONETARY_SOURCE_ID,
  bcraSeriesKey,
} from "@/modules/macro-series/domain/bcra-monetary-source";
import {
  CATALOG_RECONCILIATION_VERSION,
  reconcileWithCatalog,
} from "@/modules/macro-series/domain/catalog-reconciliation";
import { DECLARED_BCRA_SERIES } from "@/modules/macro-series/domain/declared-bcra-series";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra el catálogo y la metodología de Estadísticas Monetarias v4
 * ([ADR 0065](../docs/architecture/adr/0065-bcra-monetary-catalog-vintages.md)).
 *
 *   pnpm bcra:catalog                          # en seco: baja, planea y concilia, no escribe
 *   pnpm bcra:catalog --apply                  # registra las definiciones que cambiaron
 *   pnpm bcra:catalog --apply --accept-withdrawals
 *
 * Son nueve requests: dos páginas de catálogo y siete de metodología. Al final
 * concilia el set declarado contra el último valor que el catálogo informa.
 */
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "accept-withdrawals": { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
/** Medido el 2026-11-02: 1.610 variables, dos páginas de catálogo y siete de metodología. */
const EXPECTED_REQUESTS = 9;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const verdict = await checkSourceBudget(
  getSourceBudgetStore(),
  BCRA_MONETARY_SOURCE_ID,
  EXPECTED_REQUESTS,
  new Date().toISOString(),
);

if (verdict.status !== "allowed") {
  console.error(describeSourceRefusal(BCRA_MONETARY_SOURCE_ID, verdict));
  process.exit(2);
}

const repository = getMacroSeriesRepository();
const outcome = await recordBcraCatalog({
  source: createLiveBcraSource({
    sourceRegistry: registry,
    fetch: getSourceEgressFetch(BCRA_REQUEST_PACING),
  }),
  repository,
  ingestionRuns: getIngestionRunRepository(),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
  acceptWithdrawals: values["accept-withdrawals"],
  dryRun: DRY_RUN,
});
const { fetched, plan } = outcome;

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");
log("observado", fetched.observedAt);
log("requests · bytes", `${fetched.requests} · ${fetched.byteLength}`);
log(
  "variables",
  `${fetched.entries.length} · rechazadas ${fetched.rejections.length}`,
);
for (const rejection of fetched.rejections) {
  log(
    "  rechazo",
    `fila ${rejection.row} · id ${rejection.variableId ?? "?"} · ${rejection.field}`,
  );
}
log(
  "metodologías",
  `sin texto ${plan.methodologyMissing} · huérfanas ${fetched.orphanMethodologies} · rechazadas ${fetched.methodologyRejections.length}`,
);
log(
  "plan",
  `nuevas ${plan.opened.length} · supersedidas ${plan.superseded.length} · retiradas ${plan.withdrawn.length} · iguales ${plan.unchanged}`,
);
for (const { previous, next } of plan.superseded) {
  const basisChanged =
    previous.unit !== next.unit ||
    previous.frequency !== next.frequency ||
    previous.currencyCode !== next.currencyCode;
  log(
    `  cambia ${next.externalId}`,
    basisChanged
      ? `base: ${previous.frequency}/${previous.unit}/${previous.currencyCode} → ${next.frequency}/${next.unit}/${next.currencyCode}`
      : "descripción, categoría o metodología",
  );
}
if (plan.withdrawalsDeferred) {
  log("retiros", "diferidos: una fila rechazada no tenía id");
}
if (plan.guard.refused) {
  log(
    "guard de retiros",
    `rechazado: ${plan.guard.withdrawals} de ${plan.guard.open} vigentes (usar --accept-withdrawals)`,
  );
}
if (outcome.runId !== null) {
  log("corrida", `${outcome.runId} · ${outcome.runStatus}`);
}

console.log(
  `\n── conciliación del set declarado (${CATALOG_RECONCILIATION_VERSION})`,
);
const byId = new Map(fetched.entries.map((entry) => [entry.variableId, entry]));
let mismatches = 0;

for (const declared of DECLARED_BCRA_SERIES) {
  const entry = byId.get(declared.variableId);
  const label = `${String(declared.variableId).padStart(4)} ${declared.label.slice(0, 40)}`;

  if (entry === undefined) {
    console.log(`${label.padEnd(46)} no está en el catálogo`);
    mismatches += 1;
    continue;
  }

  const seriesKey = bcraSeriesKey(declared.variableId);
  const series = await repository.findSeries(seriesKey);
  const result = reconcileWithCatalog({
    lastReportedOn: entry.lastReportedOn,
    lastReportedValue: entry.lastReportedValue,
    stored: series?.basis != null,
    open:
      entry.lastReportedOn === null
        ? []
        : await repository.listOpenObservations(
            seriesKey,
            entry.lastReportedOn,
          ),
  });
  const detail =
    result.status === "reconciled"
      ? `${result.periodOn} = ${result.value}${result.storedThroughOn > result.periodOn ? ` (guardado hasta ${result.storedThroughOn}: el catálogo va atrás)` : ""}`
      : result.status === "mismatch"
        ? `${result.periodOn}: catálogo ${result.published} ≠ guardado ${result.stored}`
        : result.status === "not_at_date"
          ? `${result.periodOn}: no guardado (actualizar la serie)`
          : "";

  if (result.status === "mismatch") {
    mismatches += 1;
  }

  console.log(`${label.padEnd(46)} ${result.status.padEnd(17)} ${detail}`);
}

if (plan.guard.refused || mismatches > 0) {
  process.exit(1);
}
