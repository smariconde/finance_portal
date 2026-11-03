import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { BCRA_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  BcraSourceError,
  createLiveBcraSource,
} from "@/modules/macro-series/application/live-bcra-source";
import { recordBcraSeries } from "@/modules/macro-series/application/record-bcra-series";
import {
  BCRA_MONETARY_SOURCE_ID,
  bcraSeriesKey,
  MAX_SERIES_PAGES,
  SERIES_PAGE_LIMIT,
} from "@/modules/macro-series/domain/bcra-monetary-source";
import {
  DECLARED_BCRA_SERIES,
  findDeclaredBcraSeries,
} from "@/modules/macro-series/domain/declared-bcra-series";
import { isOpenDefinition } from "@/modules/macro-series/domain/series-definition";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra las observaciones del set declarado de Estadísticas Monetarias v4
 * ([ADR 0065](../docs/architecture/adr/0065-bcra-monetary-catalog-vintages.md)).
 *
 *   pnpm bcra:series --variable 30                    # en seco: baja y planea, no escribe
 *   pnpm bcra:series --variable 1 --variable 30 --apply
 *   pnpm bcra:series --declared --apply               # las 35 Principales Variables
 *   pnpm bcra:series --variable 1 --full --apply      # vuelve a leer la historia entera
 *
 * Necesita el catálogo registrado (`pnpm bcra:catalog --apply`). La primera
 * descarga de una serie trae su historia entera; las siguientes, una página.
 */
const { values } = parseArgs({
  options: {
    variable: { type: "string", multiple: true, default: [] },
    declared: { type: "boolean", default: false },
    full: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "accept-mass-change": { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

if (values.declared === values.variable.length > 0) {
  console.error(
    "Pedir --declared o una o más --variable, no las dos ni ninguna.",
  );
  process.exit(2);
}

const requested = values.declared
  ? DECLARED_BCRA_SERIES.map((series) => series.variableId)
  : values.variable.map(Number);

for (const variableId of requested) {
  if (findDeclaredBcraSeries(variableId) === null) {
    console.error(
      `${String(variableId)}: no está en el set declarado (declared-bcra-series.ts). Agregarla es un diff revisable.`,
    );
    process.exit(2);
  }
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const repository = getMacroSeriesRepository();
const today = Date.now();
let worstCase = 0;

// El peor caso en requests: la historia entera, como si fuera diaria corrida,
// para una serie sin primera descarga o con `--full`; una página si no.
for (const variableId of requested) {
  const seriesKey = bcraSeriesKey(variableId);
  const definition = (await repository.listSeriesDefinitions(seriesKey)).find(
    isOpenDefinition,
  );
  const series = await repository.findSeries(seriesKey);

  if (definition === undefined) {
    continue;
  }

  if (values.full || series?.basis == null) {
    const days =
      (today - Date.parse(`${definition.firstReportedOn}T00:00:00Z`)) /
      86_400_000;
    worstCase += Math.min(
      MAX_SERIES_PAGES,
      Math.max(1, Math.ceil(days / SERIES_PAGE_LIMIT)),
    );
  } else {
    worstCase += 1;
  }
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

if (worstCase > 0) {
  const verdict = await checkSourceBudget(
    getSourceBudgetStore(),
    BCRA_MONETARY_SOURCE_ID,
    worstCase,
    new Date().toISOString(),
  );

  if (verdict.status !== "allowed") {
    console.error(describeSourceRefusal(BCRA_MONETARY_SOURCE_ID, verdict));
    process.exit(2);
  }
}

const source = createLiveBcraSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(BCRA_REQUEST_PACING),
});
const ingestionRuns = getIngestionRunRepository();
let failures = 0;
let requests = 0;

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");
log("series · peor caso", `${requested.length} · ${worstCase} requests`);

for (const variableId of requested) {
  const label = findDeclaredBcraSeries(variableId)!.label;
  console.log(`\n── ${variableId} ${label}`);

  try {
    const outcome = await recordBcraSeries(variableId, {
      source,
      repository,
      ingestionRuns,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      full: values.full,
      acceptMassChange: values["accept-mass-change"],
      dryRun: DRY_RUN,
    });

    if (outcome.status === "definition_not_recorded") {
      log(
        "rechazada",
        "sin definición vigente: correr pnpm bcra:catalog --apply",
      );
      failures += 1;
      continue;
    }

    if (outcome.status === "definition_basis_changed") {
      const { pinned, current } = outcome;
      log(
        "rechazada",
        `la base cambió: ${pinned.frequency}/${pinned.unit}/${pinned.currencyCode} → ${current.frequency}/${current.unit}/${current.currencyCode}`,
      );
      failures += 1;
      continue;
    }

    const { fetched, plan } = outcome;
    requests += fetched.requests;
    log(
      "unidad",
      `${outcome.definition.unit} · ${outcome.definition.frequency} · ${outcome.definition.currencyCode}`,
    );
    log(
      "leído",
      `${fetched.coverage === "complete" ? "historia entera" : "ventana"} · ${fetched.points.length} de ${fetched.total} puntos · ${fetched.requests} requests · ${fetched.byteLength} bytes`,
    );
    log("revisiones desde", plan.windowStartsOn ?? "toda la serie");
    log(
      "plan",
      `nuevos ${plan.counts.new} · revisados ${plan.counts.revised} · retirados ${plan.counts.withdrawn} · repuestos ${plan.counts.reinstated} · iguales ${plan.counts.unchanged} · rechazados ${plan.counts.rejected}`,
    );
    if (plan.withdrawalsDeferred) {
      log("retiros", "diferidos: un punto rechazado no tenía fecha");
    }
    if (plan.guard.refused) {
      log(
        "guard de cambio masivo",
        `rechazado: ${plan.guard.changed} de ${plan.guard.compared} comparados (usar --accept-mass-change)`,
      );
      failures += 1;
    }
    if (outcome.runId !== null) {
      log("corrida", `${outcome.runId} · ${outcome.runStatus}`);
    }
  } catch (error) {
    if (!(error instanceof BcraSourceError)) {
      throw error;
    }

    failures += 1;
    log("falló", error.message);

    if (error.code === "rate_limited" || error.code === "fetch_failed") {
      // La fuente pidió parar o no contesta: no se sigue con las demás.
      log(
        "se detiene",
        error.retryAfter === null
          ? "sin Retry-After"
          : `Retry-After ${error.retryAfter}`,
      );
      break;
    }
  }
}

console.log(`\nrequests usados: ${requests}`);

if (failures > 0) {
  process.exit(1);
}
