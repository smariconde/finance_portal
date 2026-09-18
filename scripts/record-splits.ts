import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { createLiveSplitClaimSource } from "@/modules/corporate-actions/application/live-split-claim-source";
import { recordSplits } from "@/modules/corporate-actions/application/record-splits";
import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import { SEC_REQUEST_PACING } from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Verifica y registra los splits de uno o más emisores del universo.
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto,
 * porque cambia la base en la que una lectura `latest_adjusted` expresa cada valor.
 * Registrar exige `--apply`.
 *
 *   pnpm corporate-actions:splits --ticker AAPL
 *   pnpm corporate-actions:splits --ticker AAPL --ticker NVDA --apply
 *   pnpm corporate-actions:splits --cik 320193 --apply
 *
 * Va **después** de `pnpm fundamentals:ingest --apply`: la segunda evidencia de un
 * split son los hechos ya publicados del filer, y sin ellos no sale a la red. Un
 * request por filer, de `companyconcept`. Si el emisor tiene antecesores de reporte,
 * cada uno se evalúa con sus propios hechos.
 */
const { values } = parseArgs({
  options: {
    ticker: { type: "string", multiple: true, default: [] },
    cik: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

if (values.ticker.length === 0 && values.cik.length === 0) {
  console.error("Indicá al menos un --ticker o un --cik.");
  process.exit(2);
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");

const universe = getUniverseRepository();
const state = await universe.loadState({ indexId: SP500_INDEX_ID });
const identity = createGraphIdentityResolver(() => state.graph);
const now = new Date().toISOString();
const cutoff = pointInTimeQuerySchema.parse({
  effectiveAt: now,
  revisionPolicy: "as_known",
  knownAt: now,
  sourcePolicyVersion: "source-policy-1.0.0",
});
const corporateActions = getCorporateActionRepository();
const relationships = await corporateActions.listRelationships();
const cikByEntity = new Map(
  state.graph.identifierAssignments
    .filter(
      (candidate) =>
        candidate.identifierType === "cik" &&
        candidate.subjectType === "legal_entity",
    )
    .map((candidate) => [candidate.subjectId, candidate.normalizedValue]),
);

type Target = { readonly label: string; readonly cik: string };
const targets: Target[] = [];

for (const ticker of values.ticker) {
  const resolution = await identity.resolve({ symbol: ticker }, cutoff);
  const cik =
    resolution.status === "resolved"
      ? cikByEntity.get(resolution.legalEntityId!)
      : undefined;

  if (cik === undefined) {
    console.error(
      `${ticker}: no resuelve a un emisor con CIK en el universo (${resolution.status}).`,
    );
    process.exit(2);
  }

  targets.push({ label: ticker, cik });

  const lineage = resolveReportingLineage(
    relationships,
    resolution.legalEntityId!,
    cutoff,
  );

  for (const segment of lineage.segments.slice(1)) {
    const predecessorCik = cikByEntity.get(segment.legalEntityId);

    if (predecessorCik !== undefined) {
      targets.push({
        label: `${ticker} antecesor (hasta ${segment.reportsBefore})`,
        cik: predecessorCik,
      });
    }
  }
}

for (const cik of values.cik) {
  targets.push({ label: `CIK ${cik}`, cik });
}

// Antes de la primera llamada: un comando que la fuente tiene frenada, o cuya
// cuota del día está gastada, sale con el motivo en vez de fallar contra el
// primer request (ADR 0020).
const budgetVerdict = await checkSourceBudget(
  getSourceBudgetStore(),
  SEC_SOURCE_ID,
  1,
  new Date().toISOString(),
);

if (budgetVerdict.status !== "allowed") {
  console.error(describeSourceRefusal(SEC_SOURCE_ID, budgetVerdict));
  process.exit(2);
}

const paced = getSourceEgressFetch(SEC_REQUEST_PACING);

const dependencies = {
  sourceRegistry: registry,
  ingestionRuns: getIngestionRunRepository(),
  sourceDocuments: getSourceDocumentRepository(),
  observations: getObservationRepository(),
  corporateActions,
  loadIdentityGraph: async () => state.graph,
  source: createLiveSplitClaimSource({ fetch: paced }),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
};

for (const target of targets) {
  const outcome = await recordSplits(
    { cik: target.cik, mode: "personal", dryRun: DRY_RUN },
    dependencies,
  );

  console.log("");
  log(target.label, `CIK ${outcome.cik}`);

  if (outcome.rejection !== null) {
    log("  rechazo", outcome.rejection);
  }

  if (outcome.run !== null) {
    log("  corrida", `${outcome.run.status} ${outcome.run.runId}`);
    log("  flags", outcome.run.qualityFlags.join(", ") || "—");

    if (outcome.run.failure !== null) {
      log(
        "  falla",
        `${outcome.run.failure.code}: ${outcome.run.failure.message}`,
      );
    }
  }

  log("  revisiones sensibles", outcome.sensitiveRevisions);

  for (const document of outcome.documents) {
    log(`  ${document.kind}`, `${document.byteLength} bytes`);
  }

  for (const split of outcome.evidence?.splits ?? []) {
    log(
      `  ${split.actionType} ${split.ratio}`,
      `${split.form} ${split.accessionNumber} aceptada ${split.availableAt}`,
    );
    log(
      "    evidencia",
      `${split.evidence.perShare} por acción, ${split.evidence.shareCount} acciones, ${split.evidence.outliers} outliers, ${split.evidence.uninformative} sin información`,
    );
    log("    vigencia (cierre)", split.effectiveOn);
    log("    fechas declaradas", split.claimedPeriods.join(", "));
  }

  for (const filing of outcome.evidence?.filings ?? []) {
    log(
      `  ${filing.status}`,
      `${filing.form} ${filing.accessionNumber} ${filing.filed} ratio ${filing.ratio ?? "—"}${filing.code === null ? "" : ` (${filing.code})`}`,
    );

    if (filing.reexpressingAccession !== null) {
      log("    re-expresó", filing.reexpressingAccession);
    }
  }

  for (const claim of outcome.claimsBeforeHistory) {
    log(
      "  antes de la historia",
      `${claim.form} ${claim.accessionNumber} ${claim.filed} ratio ${claim.ratios.join("/")} (${claim.code})`,
    );
  }

  if (outcome.plan !== null) {
    log("  plan", outcome.plan.status);

    if (outcome.plan.notReconfirmed.length > 0) {
      log("  sin reconfirmar", outcome.plan.notReconfirmed.join(", "));
    }
  }

  if (outcome.applied !== null) {
    log("  escrito", `${outcome.applied.corporateActions} eventos`);
  }
}

console.log("");
log("requests a la SEC", paced.requestCount());

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para registrar.");
}

process.exit(0);
