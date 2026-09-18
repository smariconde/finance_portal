import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import {
  CIK_SCOPE,
  COMPANY_FACTS_DATASET_ID,
} from "@/modules/fundamentals/application/ingest-company-facts";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import {
  planSecHistoryPrune,
  type SecHistoryPruneDecision,
} from "@/modules/fundamentals/domain/plan-sec-history-prune";
import { SEC_CONCEPT_SELECTION_VERSION } from "@/modules/fundamentals/domain/sec-concept-selection";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Poda la historia de observaciones que quedó fuera de la ventana (ADR 0019).
 *
 * Es un job controlado, a mano y en seco por defecto, como el resto: borra filas
 * publicadas, y eso no se deshace. Publicar exige `--apply` y un `--reason`.
 *
 *   pnpm fundamentals:prune --ticker AAPL
 *   pnpm fundamentals:prune --ticker AAPL --reason "…" --apply
 *   pnpm fundamentals:prune --cik 0000320193 --reason "…" --apply
 *
 * No sale a la red. El corte lo define el ancla que registró la última ingesta
 * del filer, así que la poda deja exactamente las filas que esa misma ingesta
 * habría producido de haber corrido con la ventana. Un filer sin ancla vigente
 * se rechaza con nombre: la salida es volver a ingerirlo, que cuesta dos o tres
 * requests.
 *
 * El ticker arrastra sus antecesores de reporte, igual que la ingesta: la
 * historia de un sucesor vive en el sujeto del antecesor y su ventana es la de
 * su propio filer.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    cik: { type: "string", multiple: true, default: [] },
    reason: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(30)} ${String(value)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (values.ticker.length === 0 && values.cik.length === 0) {
  fail("Indicá al menos un --ticker o un --cik.");
}

const reason = (values.reason ?? "").trim();

if (!DRY_RUN && reason.length < 3) {
  fail("Podar exige --reason con al menos tres caracteres.");
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

type Target = { readonly label: string; readonly cik: string };
const targets: Target[] = [];
const relationships = await getCorporateActionRepository().listRelationships();
const cikByEntity = new Map(
  state.graph.identifierAssignments
    .filter(
      (candidate) =>
        candidate.identifierType === "cik" &&
        candidate.subjectType === "legal_entity",
    )
    .map((candidate) => [candidate.subjectId, candidate.normalizedValue]),
);

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, cutoff);

  if (resolution.status !== "resolved" || resolution.legalEntityId === null) {
    fail(
      `${ticker}: no resuelve a un emisor del universo (${resolution.status}).`,
    );
  }

  const cik = cikByEntity.get(resolution.legalEntityId);

  if (cik === undefined) {
    fail(`${ticker}: el emisor resuelto no tiene CIK en el grafo.`);
  }

  targets.push({ label: ticker, cik });

  const lineage = resolveReportingLineage(
    relationships,
    resolution.legalEntityId,
    cutoff,
  );

  for (const segment of lineage.segments.slice(1)) {
    const predecessorCik = cikByEntity.get(segment.legalEntityId);

    if (predecessorCik === undefined) {
      fail(
        `${ticker}: el antecesor ${segment.legalEntityId} no tiene CIK en el grafo.`,
      );
    }

    targets.push({
      label: `${ticker} antecesor (hasta ${segment.reportsBefore})`,
      cik: predecessorCik,
    });
  }
}

for (const cik of values.cik) {
  targets.push({ label: `CIK ${cik}`, cik });
}

const runs = getIngestionRunRepository();
const observations = getObservationRepository();

log("regla", "sec-history-prune-1.0.0");
log("selección vigente", SEC_CONCEPT_SELECTION_VERSION);
log("modo", DRY_RUN ? "dry run (no borra)" : "apply (borra)");

let planned = 0;
let rejected = 0;
let deletedTotal = 0;
let keptTotal = 0;

for (const target of targets) {
  console.log("");
  log(target.label, `CIK ${target.cik}`);

  const resolution = await identity.resolve(
    { identifierType: "cik", identifierValue: target.cik, scope: CIK_SCOPE },
    cutoff,
  );

  if (resolution.status !== "resolved" || resolution.legalEntityId === null) {
    rejected += 1;
    log("  rechazo", `subject_not_in_universe: ${resolution.status}`);
    continue;
  }

  const anchorRun = await runs.findLatestAnchored(
    SEC_SOURCE_ID,
    COMPANY_FACTS_DATASET_ID,
    target.cik,
  );
  const decision: SecHistoryPruneDecision = planSecHistoryPrune(
    {
      sourceId: SEC_SOURCE_ID,
      datasetId: COMPANY_FACTS_DATASET_ID,
      subjectType: "legal_entity",
      subjectId: resolution.legalEntityId,
    },
    anchorRun === null || anchorRun.selectionAnchorOn === null
      ? null
      : {
          runId: anchorRun.runId,
          selectionVersion: anchorRun.selectionVersion ?? "",
          selectionAnchorOn: anchorRun.selectionAnchorOn,
        },
  );

  if (decision.status === "rejected") {
    rejected += 1;
    log("  rechazo", `${decision.code}: ${decision.detail}`);
    continue;
  }

  planned += 1;
  log(
    "  ancla",
    `${decision.anchor.selectionAnchorOn} (corrida ${decision.anchor.runId})`,
  );
  log("  corte", `períodos anteriores a ${decision.plan.periodsEndingBefore}`);
  log(
    "  corte evidencia",
    `anteriores a ${decision.plan.evidencePeriodsEndingBefore}`,
  );

  if (DRY_RUN) {
    const counts = await observations.countPruneTargets(decision.plan);

    deletedTotal += counts.deleted;
    keptTotal += counts.kept;
    log("  borraría", `${counts.deleted} filas`);
    log("  conservaría", `${counts.kept} filas`);
    log(
      "  rango borrado",
      counts.deleted === 0
        ? "—"
        : `${counts.deletedMinAsOf} … ${counts.deletedMaxAsOf}`,
    );
    continue;
  }

  const prune = await observations.prune({
    pruneId: randomUUID(),
    ruleVersion: decision.ruleVersion,
    plan: decision.plan,
    selectionVersion: decision.anchor.selectionVersion,
    selectionAnchorOn: decision.anchor.selectionAnchorOn,
    anchorRunId: decision.anchor.runId,
    actor: "owner",
    reason,
    executedAt: new Date().toISOString(),
  });

  deletedTotal += prune.deletedCount;
  keptTotal += prune.keptCount;
  log("  poda", prune.pruneId);
  log("  borradas", `${prune.deletedCount} filas`);
  log("  conservadas", `${prune.keptCount} filas`);
  log(
    "  rango borrado",
    prune.deletedCount === 0
      ? "—"
      : `${prune.deletedMinAsOf} … ${prune.deletedMaxAsOf}`,
  );
}

console.log("");
log("sujetos planeados", planned);
log("sujetos rechazados", rejected);
log(DRY_RUN ? "filas a borrar" : "filas borradas", deletedTotal);
log("filas conservadas", keptTotal);

if (DRY_RUN) {
  console.log(
    "\nDry run: no se borró nada. Usá --reason y --apply para podar.",
  );
}
