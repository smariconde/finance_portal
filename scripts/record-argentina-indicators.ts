import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  ARGENTINA_SERIES_REQUEST_PACING,
  INDEC_REQUEST_PACING,
  SOY_REQUEST_PACING,
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
  createLiveBnaSource,
  createLiveCacPizarraSource,
  createLiveMagypSource,
  createLiveYahooFuturesSource,
  MAGYP_ESTIMACIONES_SOURCE_ID,
  MAGYP_OPEN_DATA_SOURCE_ID,
  SoySourceError,
} from "@/modules/macro-series/application/live-soy-sources";
import {
  recordArgentinaIndicator,
  type ArgentinaIndicatorSource,
} from "@/modules/macro-series/application/record-argentina-indicator";
import {
  DECLARED_ARGENTINA_INDICATORS,
  declaredArgentinaIndicator,
} from "@/modules/macro-series/domain/declared-argentina-indicators";
import {
  DECLARED_INDEC_EXPANDED_INDICATORS,
  declaredIndecExpandedIndicator,
} from "@/modules/macro-series/domain/declared-indec-expanded-indicators";
import {
  DECLARED_SOY_INDICATORS,
  declaredSoyIndicator,
} from "@/modules/macro-series/domain/declared-soy-indicators";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra los indicadores declarados de actividad y sector externo
 * ([ADR 0069](../docs/architecture/adr/0069-argentina-activity-fiscal-external.md))
 * y los de la soja ([ADR 0071](../docs/architecture/adr/0071-soy-basis-sources.md)).
 *
 *   pnpm argentina:indicators --declared                # en seco: baja y planea, no escribe
 *   pnpm argentina:indicators --indicator emae_sa --apply
 *   pnpm argentina:indicators --declared --apply
 *   pnpm argentina:indicators --expanded --apply          # IPC y canastas de F9-08
 *   pnpm argentina:indicators --soy --apply             # pizarra, BNA, Chicago y estimaciones
 *
 * Cada corrida lee la historia entera del indicador y la compara con la
 * guardada: lo nuevo, lo revisado y lo retirado salen de esa comparación.
 */
const { values } = parseArgs({
  options: {
    indicator: { type: "string", multiple: true, default: [] },
    declared: { type: "boolean", default: false },
    expanded: { type: "boolean", default: false },
    soy: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "accept-mass-change": { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

if (
  [
    values.declared,
    values.expanded,
    values.soy,
    values.indicator.length > 0,
  ].filter(Boolean).length !== 1
) {
  console.error(
    "Pedir --declared, --expanded, --soy o uno o más --indicator: uno solo.",
  );
  process.exit(2);
}

const requested = values.declared
  ? DECLARED_ARGENTINA_INDICATORS
  : values.expanded
    ? DECLARED_INDEC_EXPANDED_INDICATORS
    : values.soy
      ? DECLARED_SOY_INDICATORS
      : values.indicator.map((id) => {
          const indicator =
            declaredArgentinaIndicator(id) ??
            declaredIndecExpandedIndicator(id) ??
            declaredSoyIndicator(id);
          if (indicator === null) {
            console.error(
              `${id}: no está en un set declarado. Agregarlo es un diff revisable.`,
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
  ...[
    createLiveCacPizarraSource,
    createLiveBnaSource,
    createLiveYahooFuturesSource,
    createLiveMagypSource,
  ].map((create) =>
    create({
      sourceRegistry: registry,
      fetch: getSourceEgressFetch(SOY_REQUEST_PACING),
      now: () => new Date(),
    }),
  ),
];

// Peor caso: una página por indicador. Son mensuales y una página son 1.000
// meses; una serie más larga lo excede y la corrida lo dice en requests usados.
// Las estimaciones agrícolas son un `POST` y un CSV para las cuatro series.
const worstCaseBySource = new Map<string, number>();
for (const indicator of requested) {
  if (indicator.sourceId === MAGYP_ESTIMACIONES_SOURCE_ID) {
    worstCaseBySource.set(MAGYP_ESTIMACIONES_SOURCE_ID, 1);
    worstCaseBySource.set(MAGYP_OPEN_DATA_SOURCE_ID, 1);
    continue;
  }
  worstCaseBySource.set(
    indicator.sourceId,
    (worstCaseBySource.get(indicator.sourceId) ?? 0) +
      (declaredIndecExpandedIndicator(indicator.id) ? 2 : 1),
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
    if (fetched.reconciliation?.status === "matched") {
      log(
        "variación publicada",
        `${fetched.reconciliation.periodOn}: ${fetched.reconciliation.published} % · calculada ${fetched.reconciliation.computed} % · diferencia ${fetched.reconciliation.differencePp} pp`,
      );
    }
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
      !(error instanceof IndecSourceError) &&
      !(error instanceof SoySourceError)
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
