import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { BCRA_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createLiveBcraFxSource } from "@/modules/macro-series/application/live-bcra-fx-source";
import { BcraSourceError } from "@/modules/macro-series/application/live-bcra-source";
import { recordBcraCatalog } from "@/modules/macro-series/application/record-bcra-catalog";
import { recordBcraSeries } from "@/modules/macro-series/application/record-bcra-series";
import {
  BCRA_FX_PAGE_LIMIT,
  BCRA_FX_PROFILE,
  BCRA_FX_SOURCE_ID,
  bcraFxSeriesKey,
  DECLARED_FX_CURRENCIES,
  MAX_FX_PAGES,
} from "@/modules/macro-series/domain/bcra-fx-source";
import { catalogPlanChanges } from "@/modules/macro-series/domain/series-definition";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getMacroSeriesRepository } from "@/server/persistence/get-macro-series-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Registra las cotizaciones de Estadísticas Cambiarias v1
 * ([ADR 0067](../docs/architecture/adr/0067-bcra-official-fx-quotes.md)): el
 * maestro de monedas y la serie de cada moneda declarada.
 *
 *   pnpm bcra:fx                          # en seco: baja y planea, no escribe
 *   pnpm bcra:fx --apply                  # maestro + USD, EUR, BRL y CNY
 *   pnpm bcra:fx --currency USD --apply   # una sola moneda
 *   pnpm bcra:fx --full --apply           # vuelve a leer la historia entera
 *
 * La primera descarga de una moneda trae su historia entera; las siguientes,
 * una página (los 1.000 días más recientes).
 */
const { values } = parseArgs({
  options: {
    currency: { type: "string", multiple: true, default: [] },
    full: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "accept-withdrawals": { type: "boolean", default: false },
    "accept-mass-change": { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const requested =
  values.currency.length === 0
    ? DECLARED_FX_CURRENCIES
    : values.currency.map((code) => {
        const currency = DECLARED_FX_CURRENCIES.find(
          (candidate) => candidate.isoCode === code.toUpperCase(),
        );

        if (currency === undefined) {
          console.error(
            `${code}: no está declarada (bcra-fx-source.ts). Agregarla es un diff revisable.`,
          );
          process.exit(2);
        }

        return currency;
      });

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const repository = getMacroSeriesRepository();
const today = Date.now();
// El peor caso: el maestro, y por moneda su historia entera si no tiene base
// fijada (o con `--full`) o una página si la tiene.
let worstCase = 1;

for (const currency of requested) {
  const series = await repository.findSeries(
    bcraFxSeriesKey(currency.isoNumeric),
  );

  if (values.full || series?.basis == null) {
    const days =
      (today - Date.parse(`${currency.firstReportedOn}T00:00:00Z`)) /
      86_400_000;
    worstCase += Math.min(
      MAX_FX_PAGES,
      Math.max(1, Math.ceil(days / BCRA_FX_PAGE_LIMIT)),
    );
  } else {
    worstCase += 1;
  }
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const verdict = await checkSourceBudget(
  getSourceBudgetStore(),
  BCRA_FX_SOURCE_ID,
  worstCase,
  new Date().toISOString(),
);

if (verdict.status !== "allowed") {
  console.error(describeSourceRefusal(BCRA_FX_SOURCE_ID, verdict));
  process.exit(2);
}

const now = () => new Date().toISOString();
const source = createLiveBcraFxSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(BCRA_REQUEST_PACING),
  now,
});
const ingestionRuns = getIngestionRunRepository();
const dependencies = {
  source,
  repository,
  ingestionRuns,
  now,
  newId: () => randomUUID(),
  profile: BCRA_FX_PROFILE,
  dryRun: DRY_RUN,
};
let failures = 0;
let requests = 0;

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");
log("monedas · peor caso", `${requested.length} · ${worstCase} requests`);

try {
  const catalog = await recordBcraCatalog({
    ...dependencies,
    acceptWithdrawals: values["accept-withdrawals"],
  });
  requests += catalog.fetched.requests;
  log(
    "maestro",
    `${catalog.fetched.entries.length} de ${DECLARED_FX_CURRENCIES.length} declaradas · ${catalog.fetched.byteLength} bytes`,
  );
  log(
    "plan del maestro",
    `nuevas ${catalog.plan.opened.length} · supersedidas ${catalog.plan.superseded.length} · retiradas ${catalog.plan.withdrawn.length} · iguales ${catalog.plan.unchanged}`,
  );

  if (catalog.plan.guard.refused) {
    log(
      "guard de bajas",
      `rechazado: ${catalog.plan.guard.withdrawals} de ${catalog.plan.guard.open} (usar --accept-withdrawals)`,
    );
    failures += 1;
  }

  if (catalog.runId !== null) {
    log("corrida", `${catalog.runId} · ${catalog.runStatus}`);
  }

  if (DRY_RUN && catalogPlanChanges(catalog.plan) > 0) {
    // En seco las definiciones nuevas no se escriben, así que las series no
    // tienen contra qué planear.
    log("series", "en seco: hacen falta las definiciones (correr con --apply)");
  }
} catch (error) {
  if (!(error instanceof BcraSourceError)) {
    throw error;
  }

  log("falló el maestro", error.message);
  process.exit(1);
}

for (const currency of requested) {
  console.log(`\n── ${currency.isoCode} (${currency.isoNumeric})`);

  try {
    const outcome = await recordBcraSeries(currency.isoNumeric, {
      ...dependencies,
      full: values.full,
      acceptMassChange: values["accept-mass-change"],
    });

    if (outcome.status === "definition_not_recorded") {
      log("sin definición", "el maestro no la registró todavía");
      if (!DRY_RUN) {
        failures += 1;
      }
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
      "leído",
      `${fetched.coverage === "complete" ? "historia entera" : "ventana"} · ${fetched.points.length} de ${fetched.total} cotizaciones · ${fetched.requests} requests · ${fetched.byteLength} bytes`,
    );
    log(
      "fechas propias",
      `${fetched.points.at(-1)?.periodOn ?? "—"} a ${fetched.points[0]?.periodOn ?? "—"}`,
    );
    log("revisiones desde", plan.windowStartsOn ?? "toda la serie");
    log(
      "plan",
      `nuevos ${plan.counts.new} · revisados ${plan.counts.revised} · retirados ${plan.counts.withdrawn} · repuestos ${plan.counts.reinstated} · iguales ${plan.counts.unchanged} · rechazados ${plan.counts.rejected}`,
    );

    if (fetched.rejections.length > 0) {
      log(
        "días rechazados",
        fetched.rejections
          .map(
            (rejection) => `${rejection.periodOn ?? "?"} (${rejection.field})`,
          )
          .join(", "),
      );
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
process.exit(failures > 0 ? 1 : 0);
