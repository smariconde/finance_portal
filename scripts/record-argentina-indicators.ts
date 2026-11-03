import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  ARGENTINA_SERIES_REQUEST_PACING,
  INDEC_REQUEST_PACING,
} from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  ArgentinaSeriesSourceError,
  createLiveArgentinaSeriesSource,
} from "@/modules/macro-series/application/live-argentina-series-source";
import {
  createLiveIndecSource,
  IndecSourceError,
} from "@/modules/macro-series/application/live-indec-source";
import {
  recordArgentinaIndicator,
  type ArgentinaIndicatorSource,
} from "@/modules/macro-series/application/record-argentina-indicator";
import {
  DECLARED_ARGENTINA_INDICATORS,
  declaredArgentinaIndicator,
} from "@/modules/macro-series/domain/declared-argentina-indicators";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra los indicadores declarados de actividad y sector externo
 * ([ADR 0069](../docs/architecture/adr/0069-argentina-activity-fiscal-external.md)).
 *
 *   pnpm argentina:indicators --declared                # en seco: baja y planea, no escribe
 *   pnpm argentina:indicators --indicator emae_sa --apply
 *   pnpm argentina:indicators --declared --apply
 *
 * Cada corrida lee la historia entera del indicador y la compara con la
 * guardada: lo nuevo, lo revisado y lo retirado salen de esa comparación.
 */
const { values } = parseArgs({
  options: {
    indicator: { type: "string", multiple: true, default: [] },
    declared: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "accept-mass-change": { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

if (values.declared === values.indicator.length > 0) {
  console.error(
    "Pedir --declared o uno o más --indicator, no las dos ni ninguna.",
  );
  process.exit(2);
}

const requested = values.declared
  ? DECLARED_ARGENTINA_INDICATORS
  : values.indicator.map((id) => {
      const indicator = declaredArgentinaIndicator(id);
      if (indicator === null) {
        console.error(
          `${id}: no está en el set declarado (declared-argentina-indicators.ts). Agregarlo es un diff revisable.`,
        );
        process.exit(2);
      }
      return indicator;
    });

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const sources: ArgentinaIndicatorSource[] = [
  createLiveArgentinaSeriesSource({
    sourceRegistry: registry,
    fetch: getSourceEgressFetch(ARGENTINA_SERIES_REQUEST_PACING),
  }),
  createLiveIndecSource({
    sourceRegistry: registry,
    fetch: getSourceEgressFetch(INDEC_REQUEST_PACING),
  }),
];

// Peor caso: una página por indicador. Son mensuales y una página son 1.000
// meses; una serie más larga lo excede y la corrida lo dice en requests usados.
const worstCaseBySource = new Map<string, number>();
for (const indicator of requested) {
  worstCaseBySource.set(
    indicator.sourceId,
    (worstCaseBySource.get(indicator.sourceId) ?? 0) + 1,
  );
}
for (const [sourceId, worstCase] of worstCaseBySource) {
  const verdict = await checkSourceBudget(
    getSourceBudgetStore(),
    sourceId,
    worstCase,
    new Date().toISOString(),
  );
  if (verdict.status !== "allowed") {
    console.error(describeSourceRefusal(sourceId, verdict));
    process.exit(2);
  }
}

const repository = getArgentinaIndicatorRepository();
const ingestionRuns = getIngestionRunRepository();
let failures = 0;
let requests = 0;

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");
log(
  "indicadores · peor caso",
  `${requested.length} · ${[...worstCaseBySource.values()].reduce((a, b) => a + b, 0)} requests`,
);

for (const indicator of requested) {
  console.log(
    `\n── ${indicator.id} (${indicator.sourceId}:${indicator.externalId})`,
  );

  try {
    const outcome = await recordArgentinaIndicator(indicator, {
      sources,
      repository,
      ingestionRuns,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      acceptMassChange: values["accept-mass-change"],
      dryRun: DRY_RUN,
    });
    const { fetched, plan } = outcome;
    requests += fetched.requests;
    const last = fetched.points.at(-1);
    log(
      "leído",
      `${fetched.points.length} puntos · ${fetched.requests} requests · ${fetched.bytes} bytes`,
    );
    log(
      "último punto",
      last ? `${last.periodOn} = ${last.value ?? "null"}` : "ninguno",
    );
    log(
      "plan",
      `nuevos ${plan.counts.new} · revisados ${plan.counts.revised} · retirados ${plan.counts.withdrawn} · iguales ${plan.counts.unchanged}`,
    );
    if (plan.definition !== null) {
      log("definición", `revisión ${plan.definition.revision}`);
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
    if (
      !(error instanceof ArgentinaSeriesSourceError) &&
      !(error instanceof IndecSourceError)
    ) {
      throw error;
    }
    failures += 1;
    log("falló", error.message);
    if (error.code === "unauthorized") {
      log(
        "token",
        "el INDEC rechazó INDEC_API_TOKEN: venció o se regeneró (docs/runbooks/indec-token.md)",
      );
      break;
    }
    if (error.code === "rate_limited" || error.code === "fetch_failed") {
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
