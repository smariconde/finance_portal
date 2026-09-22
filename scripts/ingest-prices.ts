import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { PRICES_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { ingestPrices } from "@/modules/prices/application/ingest-prices";
import {
  createLivePriceSource,
  PRICES_SOURCE_ID,
} from "@/modules/prices/application/live-price-source";
import { CHART_PARSER_VERSION } from "@/modules/prices/domain/parse-chart-payload";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getPriceRepository } from "@/server/persistence/get-price-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Ingiere la serie diaria de una o más securities del universo constituido
 * ([ADR 0026](../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto.
 * Publicar exige `--apply`.
 *
 *   pnpm prices:ingest --ticker AAPL
 *   pnpm prices:ingest --ticker AAPL --ticker NVDA --apply
 *
 * El ticker se resuelve contra el grafo persistido: lo que sale por la red es el
 * símbolo que el universo ya asignó. Una request por security trae cinco años.
 *
 * Lo que se guarda es la serie **cruda**. La fuente publica la serie ajustada
 * por los splits posteriores y la reescribe hacia atrás en cada uno, así que
 * guardarla tal cual metería look-ahead en la base y rompería la idempotencia de
 * la ingesta. El des-ajuste usa los splits que la misma respuesta trae.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

if (values.ticker.length === 0) {
  console.error("Indicá al menos un --ticker.");
  process.exit(2);
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");

// Antes de la primera llamada: una fuente frenada, o sin cuota del día, sale con
// el motivo en vez de fallar contra el primer request (ADR 0020).
const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  PRICES_SOURCE_ID,
  values.ticker.length,
  new Date().toISOString(),
);

if (budgetVerdict.status !== "allowed") {
  console.error(describeSourceRefusal(PRICES_SOURCE_ID, budgetVerdict));
  process.exit(2);
}

const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const identity = createGraphIdentityResolver(() => state.graph);
const now = new Date().toISOString();
const cutoff = pointInTimeQuerySchema.parse({
  effectiveAt: now,
  revisionPolicy: "as_known",
  knownAt: now,
  sourcePolicyVersion: "source-policy-1.0.0",
});

type Target = { readonly symbol: string; readonly securityId: string };
const targets: Target[] = [];

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, cutoff);

  if (resolution.status !== "resolved" || resolution.securityId === null) {
    console.error(
      `${ticker}: no resuelve a una security del universo (${resolution.status}).`,
    );
    process.exit(2);
  }

  targets.push({ symbol: ticker, securityId: resolution.securityId });
}

const source = createLivePriceSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(PRICES_REQUEST_PACING),
});

const repository = getPriceRepository();
const runs = getIngestionRunRepository();

console.log("");
log("fuente", PRICES_SOURCE_ID);
log("parser", CHART_PARSER_VERSION);
log("securities", targets.length);
log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");

let totalBars = 0;
let totalBytes = 0;

for (const target of targets) {
  console.log("");
  log(target.symbol, target.securityId);

  const outcome = await ingestPrices(
    { securityId: target.securityId, symbol: target.symbol },
    {
      source,
      repository,
      ingestionRuns: runs,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      hashContent: (input) => createHash("sha256").update(input).digest("hex"),
      dryRun: DRY_RUN,
    },
  );

  totalBars += outcome.bars;
  totalBytes += outcome.byteLength;

  log("  moneda", outcome.currency);
  log("  ruedas", outcome.bars);
  log("  sin cierre", outcome.barsWithoutClose);
  log("  splits", outcome.splits);
  log("  dividendos", outcome.dividends);
  // Cuántas ruedas la fuente publica reexpresadas: es la medida de cuánto
  // look-ahead se habría guardado ingiriendo su serie tal cual.
  log("  reexpresadas", outcome.barsRestatedBySource);
  log("  bytes", outcome.byteLength);

  if (outcome.summary === null) {
    continue;
  }

  log("  corrida", `${outcome.runStatus} ${outcome.runId}`);
  log("  publicadas", outcome.summary.closesInserted);
  log("  duplicadas", outcome.summary.closesDuplicate);
  log("  eventos nuevos", outcome.summary.eventsInserted);

  if (outcome.summary.closesConflicting.length > 0) {
    // Una fila cruda es inmutable: si la fuente devuelve otro cierre para una
    // rueda ya guardada, eso es un hallazgo y no una actualización.
    log(
      "  ⚠ pasado cambiado",
      outcome.summary.closesConflicting.slice(0, 5).join(", ") +
        (outcome.summary.closesConflicting.length > 5 ? " …" : ""),
    );
  }
}

console.log("");
log("ruedas totales", totalBars);
log("bytes totales", totalBytes);

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para publicar.");
}

process.exit(0);
