import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  createLiveConsensusSource,
  CONSENSUS_SOURCE_ID,
} from "@/modules/consensus/application/live-consensus-source";
import { recordConsensus } from "@/modules/consensus/application/record-consensus";
import { EARNINGS_ESTIMATES_PARSER_VERSION } from "@/modules/consensus/domain/earnings-estimates-parser";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { usMarketGraph } from "@/modules/identity/domain/us-market-graph";
import { CONSENSUS_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getConsensusRepository } from "@/server/persistence/get-consensus-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Captura el consenso de analistas de uno o más tickers del universo
 * ([ADR 0083](../docs/architecture/adr/0083-consensus-estimates-forward-pe.md)).
 *
 *   pnpm consensus:ingest --ticker AAPL            # dry run: pide y planea, no escribe
 *   pnpm consensus:ingest --ticker AAPL --apply    # registra la corrida y las revisiones
 *
 * Un pedido por ticker contra los 25 diarios del plan gratis. Se guardan sólo
 * los dos ejercicios; los trimestres se cuentan y se descartan.
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

const state = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});
const identity = createGraphIdentityResolver(() => usMarketGraph(state.graph));
const nowIso = new Date().toISOString();
const cutoff = pointInTimeQuerySchema.parse({
  effectiveAt: nowIso,
  revisionPolicy: "as_known",
  knownAt: nowIso,
  sourcePolicyVersion: "source-policy-1.0.0",
});

const targets: { symbol: string; securityId: string }[] = [];
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

const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  CONSENSUS_SOURCE_ID,
  targets.length,
  new Date().toISOString(),
);
if (budgetVerdict.status !== "allowed") {
  console.error(describeSourceRefusal(CONSENSUS_SOURCE_ID, budgetVerdict));
  process.exit(2);
}

const source = createLiveConsensusSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(CONSENSUS_REQUEST_PACING),
});

console.log("");
log("fuente", CONSENSUS_SOURCE_ID);
log("parser", EARNINGS_ESTIMATES_PARSER_VERSION);
log("tickers", targets.length);
log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");

for (const target of targets) {
  console.log("");
  log(target.symbol, target.securityId);
  const outcome = await recordConsensus(target, {
    source,
    repository: getConsensusRepository(),
    ingestionRuns: getIngestionRunRepository(),
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    hashContent: (input) => createHash("sha256").update(input).digest("hex"),
    dryRun: DRY_RUN,
  });
  for (const year of outcome.fiscalYears) {
    log(
      `  FY ${year.periodEnd}`,
      `${year.epsAverage} (${year.epsAnalystCount ?? "?"} analistas)`,
    );
  }
  log("  trimestres descartados", outcome.quartersDropped);
  log("  revisiones nuevas", outcome.plan.inserts.length);
  log("  sin cambios", outcome.plan.unchanged);
  log("  retirados", outcome.plan.withdrawn);
  log("  bytes", outcome.byteLength);
  if (outcome.runId !== null) {
    log("  corrida", `${outcome.runStatus} ${outcome.runId}`);
  }
}

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para publicar.");
}

process.exit(0);
