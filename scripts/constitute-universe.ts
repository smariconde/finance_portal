import { createHash, randomUUID } from "node:crypto";

import { DATAHUB_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { classifyUniverseSectors } from "@/modules/classification/application/classify-universe-sectors";
import { getClassificationRepository } from "@/server/persistence/get-classification-repository";
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

/**
 * Clasificación sectorial (`F7-02`, ADR 0025).
 *
 * Corre después de la constitución y fuera de su transacción a propósito: el
 * sector no constituye el grafo, y si esto fallara el universo seguiría siendo
 * correcto y volver a correr lo arreglaría, porque el mismo pin no escribe nada.
 *
 * El `available_at` de cada aserción es el `committedAt` del pin y no el
 * instante de esta corrida, que es lo que hace que un `as_known` anterior al
 * commit no vea la clasificación (`TM-06`).
 */
const universeState = await getUniverseRepository().loadState({
  indexId: SP500_INDEX_ID,
});

const entityIdByCik = new Map(
  universeState.graph.identifierAssignments
    .filter(
      (assignment) =>
        assignment.identifierType === "cik" &&
        assignment.validTo === null &&
        assignment.supersededAt === null,
    )
    .map((assignment) => [assignment.normalizedValue, assignment.subjectId]),
);

const sectors = await classifyUniverseSectors(
  {
    claims: snapshot.claims.map((claim) => ({
      symbol: claim.symbol,
      sector: claim.sector,
    })),
    resolved: outcome.resolution.resolved.map((entry) => ({
      claimSymbol: entry.claimSymbol,
      normalizedCik: entry.normalizedCik,
    })),
    entityIdByCik,
    pin: SP500_CONSTITUENTS_PIN,
    sourceId: CONSTITUENTS_SOURCE_ID,
    sourceDocumentId: SP500_CONSTITUENTS_PIN.commit,
  },
  {
    repository: getClassificationRepository(),
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  },
);

console.log("");
log("taxonomía", sectors.plan.taxonomyId);
log("versión", sectors.plan.taxonomyVersion.slice(0, 12));
log("  abiertas", sectors.plan.counts.opened);
log("  superseded", sectors.plan.counts.superseded);
log("  sin cambio", sectors.plan.counts.unchanged);
log("  rechazadas", sectors.plan.counts.rejected);
log("  no reafirmadas", sectors.plan.counts.notReasserted);

if (sectors.conflicts.length > 0) {
  log("  clases en conflicto", sectors.conflicts.join(", "));
}

if (sectors.unresolvedSubjects.length > 0) {
  log("  sin entidad legal", sectors.unresolvedSubjects.length);
}

const bySectorCode = new Map<string, number>();

for (const rejection of sectors.plan.rejections) {
  bySectorCode.set(rejection.code, (bySectorCode.get(rejection.code) ?? 0) + 1);
}

for (const [code, count] of bySectorCode) {
  log(`  ${code}`, count);
}

process.exit(0);
