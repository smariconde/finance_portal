import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  ADR_PAIR_HISTORY_FROM,
  AdrLegIngestionError,
  ingestAdrLeg,
} from "@/modules/implied-fx/application/ingest-adr-pair-legs";
import { DECLARED_ADR_PAIRS } from "@/modules/implied-fx/domain/declared-adr-pairs";
import { PRICES_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  createLivePriceSource,
  PRICES_SOURCE_ID,
  PriceSourceError,
} from "@/modules/prices/application/live-price-source";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getAdrPairRepository } from "@/server/persistence/get-adr-pair-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Descarga las patas de los pares ADR declarados
 * ([ADR 0068](../docs/architecture/adr/0068-implied-ccl-adr-pairs.md)): una
 * request por pata, la historia desde 2000, cierres crudos.
 *
 *   pnpm ccl:ingest                   # en seco: baja y reporta, no escribe
 *   pnpm ccl:ingest --apply           # los diez pares, veinte requests
 *   pnpm ccl:ingest --pair ggal --apply
 */
const { values } = parseArgs({
  options: {
    pair: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;
const pairs =
  values.pair.length === 0
    ? DECLARED_ADR_PAIRS
    : DECLARED_ADR_PAIRS.filter((pair) => values.pair.includes(pair.pairId));

if (pairs.length !== Math.max(values.pair.length, pairs.length)) {
  console.error(
    `--pair tiene que ser uno de ${DECLARED_ADR_PAIRS.map((pair) => pair.pairId).join(", ")}.`,
  );
  process.exit(2);
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

const verdict = await checkSourceBudget(
  getSourceBudgetStore(),
  PRICES_SOURCE_ID,
  pairs.length * 2,
  new Date().toISOString(),
);

if (verdict.status !== "allowed") {
  console.error(describeSourceRefusal(PRICES_SOURCE_ID, verdict));
  process.exit(2);
}

const source = createLivePriceSource({
  sourceRegistry: registry,
  fetch: getSourceEgressFetch(PRICES_REQUEST_PACING),
  now: () => new Date(),
  historyFrom: ADR_PAIR_HISTORY_FROM,
});
const dependencies = {
  source,
  repository: getAdrPairRepository(),
  ingestionRuns: getIngestionRunRepository(),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
  hashContent: (input: string) =>
    createHash("sha256").update(input).digest("hex"),
  dryRun: DRY_RUN,
};
let failures = 0;
let requests = 0;

log("modo", DRY_RUN ? "dry run (no escribe)" : "apply");
log("pares · requests", `${pairs.length} · ${pairs.length * 2}`);

for (const pair of pairs) {
  console.log(`\n── ${pair.pairId} · ${pair.issuer}`);

  for (const side of ["adr", "local"] as const) {
    try {
      const outcome = await ingestAdrLeg(pair.pairId, side, dependencies);
      requests += 1;
      log(
        `${side} ${outcome.symbol}`,
        `${outcome.bars} ruedas · ${outcome.firstOn ?? "—"} a ${outcome.lastOn ?? "—"} · splits ${outcome.splits}${outcome.barsUnsettled.length > 0 ? ` · en curso ${outcome.barsUnsettled.join(",")}` : ""}`,
      );

      if (outcome.summary !== null) {
        log(
          "   escritura",
          `nuevas ${outcome.summary.closesInserted} · iguales ${outcome.summary.closesDuplicate} · distintas ${outcome.summary.closesConflicting.length}${outcome.summary.closesConflicting.length > 0 ? ` (${outcome.summary.closesConflicting.slice(0, 5).join(", ")}…)` : ""}`,
        );
      }

      if (outcome.runId !== null) {
        log("   corrida", `${outcome.runId} · ${outcome.runStatus}`);
      }
    } catch (error) {
      if (
        !(error instanceof PriceSourceError) &&
        !(error instanceof AdrLegIngestionError)
      ) {
        throw error;
      }

      failures += 1;
      log(`${side} falló`, error.message);
    }
  }
}

console.log(`\nrequests usados: ${requests}`);
process.exit(failures > 0 ? 1 : 0);
