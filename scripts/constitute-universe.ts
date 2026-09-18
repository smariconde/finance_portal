import { randomUUID } from "node:crypto";

import { DATAHUB_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { constituteUniverse } from "@/modules/universe/application/constitute-universe";
import {
  buildConstituentsUrl,
  CONSTITUENTS_SOURCE_ID,
  createLiveUniverseSource,
  SP500_CONSTITUENTS_PIN,
  SP500_INDEX_ID,
} from "@/modules/universe/application/live-universe-source";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Constituye el universo real del S&P 500 sobre el almacenamiento personal.
 *
 * Es un job controlado y no un gate: se corre a mano, con `--dry-run` por defecto,
 * porque un rebalanceo **cierra membresías** y esa no es una operación que deba
 * pasar sin que alguien la mire. Escribir exige `--apply`.
 *
 * El modo efectivo se resuelve como en cualquier otra composición: un runtime que
 * no probó ser privado se niega antes de resolver un nombre.
 */
const DRY_RUN = !process.argv.includes("--apply");

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(22)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");
log("registro sin cambios", sync.unchanged.length);

// Antes de la primera llamada: un comando que la fuente tiene frenada, o cuya
// cuota del día está gastada, sale con el motivo en vez de fallar contra el
// primer request (ADR 0020).
const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  CONSTITUENTS_SOURCE_ID,
  1,
  new Date().toISOString(),
);

if (budgetVerdict.status !== "allowed") {
  console.error(describeSourceRefusal(CONSTITUENTS_SOURCE_ID, budgetVerdict));
  process.exit(2);
}

const fetch = getSourceEgressFetch(DATAHUB_REQUEST_PACING);

const source = createLiveUniverseSource({
  sourceRegistry: registry,
  fetch,
  constituentsUrl: buildConstituentsUrl(SP500_CONSTITUENTS_PIN.commit),
});

console.log("");
log("pin commit", SP500_CONSTITUENTS_PIN.commit);
log("pin fecha", SP500_CONSTITUENTS_PIN.committedAt);

const snapshot = await source.load();

console.log("");
for (const document of snapshot.documents) {
  log(document.sourceId, `${document.byteLength} bytes`);
  log("  parser", document.parserVersion);
  log("  hash", document.contentHash.slice(0, 16));
  log("  filas rechazadas", document.rejectedRows);
}

console.log("");
log("claims", snapshot.claims.length);
log("asignaciones", snapshot.assignments.length);

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para constituir.");
  process.exit(0);
}

const outcome = await constituteUniverse(
  {
    indexId: SP500_INDEX_ID,
    // La vigencia del snapshot es el commit que lo publicó, no el instante de la
    // corrida: dos corridas del mismo pin describen el mismo corte del índice.
    effectiveAt: SP500_CONSTITUENTS_PIN.committedAt,
    availableAt: SP500_CONSTITUENTS_PIN.committedAt,
    sourceId: snapshot.documents[0].sourceId,
    sourceDocumentId: SP500_CONSTITUENTS_PIN.commit,
    claims: [...snapshot.claims],
    assignments: [...snapshot.assignments],
  },
  {
    repository: getUniverseRepository(),
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  },
);

console.log("");
log("miembros", outcome.summary.members);
log("rechazos", outcome.plan.rejections.length);

for (const [key, value] of Object.entries(outcome.summary.applied)) {
  log(`  ${key}`, value);
}

const byCode = new Map<string, number>();

for (const rejection of outcome.plan.rejections) {
  byCode.set(rejection.code, (byCode.get(rejection.code) ?? 0) + 1);
}

for (const [code, count] of byCode) {
  log(`  ${code}`, count);
}

process.exit(0);
