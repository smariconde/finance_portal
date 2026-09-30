import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import { PRICES_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { ingestBenchmark } from "@/modules/prices/application/ingest-benchmark";
import { ingestPrices } from "@/modules/prices/application/ingest-prices";
import {
  createLivePriceSource,
  PRICES_SOURCE_ID,
} from "@/modules/prices/application/live-price-source";
import { findDeclaredBenchmark } from "@/modules/prices/domain/declared-benchmarks";
import { CHART_PARSER_VERSION } from "@/modules/prices/domain/parse-chart-payload";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
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
 *   pnpm prices:ingest --sector information-technology --apply
 *   pnpm prices:ingest --benchmark sp500-total-return --apply
 *
 * El ticker se resuelve contra el grafo persistido: lo que sale por la red es el
 * símbolo que el universo ya asignó. `--sector` toma la población del sector a
 * hoy (ADR 0025) y `--benchmark` una serie de referencia declarada (ADR 0029).
 * Una request por serie trae cinco años y dos semanas.
 *
 * Lo que se guarda es la serie **cruda**. La fuente publica la serie ajustada
 * por los splits posteriores y la reescribe hacia atrás en cada uno, así que
 * guardarla tal cual metería look-ahead en la base y rompería la idempotencia de
 * la ingesta. El des-ajuste usa los splits que la misma respuesta trae.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    sector: { type: "string", multiple: true, default: [] },
    benchmark: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

if (
  values.ticker.length === 0 &&
  values.sector.length === 0 &&
  values.benchmark.length === 0
) {
  console.error("Indicá al menos un --ticker, --sector o --benchmark.");
  process.exit(2);
}

for (const benchmarkId of values.benchmark) {
  if (findDeclaredBenchmark(benchmarkId) === null) {
    console.error(`${benchmarkId}: no es una referencia declarada.`);
    process.exit(2);
  }
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");

const universe = getUniverseRepository();
const state = await universe.loadState({
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

for (const code of values.sector) {
  const { population, graph } = await loadSectorPopulation(
    { indexId: SP500_INDEX_ID, code, query: cutoff },
    { universe, classifications: getClassificationRepository() },
  );

  if (population.members.length === 0) {
    console.error(`${code}: el sector no tiene miembros al corte.`);
    process.exit(2);
  }

  for (const member of population.members) {
    const [ticker] = securityTickersAt(graph, member.securityId, cutoff);

    if (ticker === undefined) {
      console.error(`${member.securityId}: sin ticker vigente, queda afuera.`);
      continue;
    }

    if (!targets.some((target) => target.securityId === member.securityId)) {
      targets.push({ symbol: ticker.symbol, securityId: member.securityId });
    }
  }
}

// Antes de la primera llamada: una fuente frenada, o sin cuota del día, sale con
// el motivo en vez de fallar contra el primer request (ADR 0020).
const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  PRICES_SOURCE_ID,
  targets.length + values.benchmark.length,
  new Date().toISOString(),
);

if (budgetVerdict.status !== "allowed") {
  console.error(describeSourceRefusal(PRICES_SOURCE_ID, budgetVerdict));
  process.exit(2);
}

const source = createLivePriceSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(PRICES_REQUEST_PACING),
  now: () => new Date(),
});

const repository = getPriceRepository();
const runs = getIngestionRunRepository();

console.log("");
log("fuente", PRICES_SOURCE_ID);
log("parser", CHART_PARSER_VERSION);
log("securities", targets.length);
log("referencias", values.benchmark.join(", ") || "—");
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
  log("  en curso", outcome.barsUnsettled.join(", ") || "—");
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

  if (outcome.summary.eventsConflicting.length > 0) {
    // Lo mismo para un split o un dividendo. Un dividendo guardado con
    // `price-unadjust-1.0.0` antes de un split cae acá: ADR 0028.
    log(
      "  ⚠ evento cambiado",
      outcome.summary.eventsConflicting.slice(0, 5).join(", ") +
        (outcome.summary.eventsConflicting.length > 5 ? " …" : ""),
    );
  }
}

for (const benchmarkId of values.benchmark) {
  console.log("");
  log(benchmarkId, "referencia");

  const outcome = await ingestBenchmark(benchmarkId, {
    source,
    repository,
    ingestionRuns: runs,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    hashContent: (input) => createHash("sha256").update(input).digest("hex"),
    dryRun: DRY_RUN,
  });

  totalBars += outcome.bars;
  totalBytes += outcome.byteLength;

  log("  símbolo", outcome.sourceSymbol);
  log("  ruedas", outcome.bars);
  log("  sin cierre", outcome.barsWithoutClose);
  log("  en curso", outcome.barsUnsettled.join(", ") || "—");
  log("  bytes", outcome.byteLength);

  if (outcome.summary === null) {
    continue;
  }

  log("  corrida", `${outcome.runStatus} ${outcome.runId}`);
  log("  publicadas", outcome.summary.closesInserted);
  log("  duplicadas", outcome.summary.closesDuplicate);

  if (outcome.summary.closesConflicting.length > 0) {
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
