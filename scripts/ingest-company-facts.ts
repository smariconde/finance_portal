import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { resolveReportingLineage } from "@/modules/corporate-actions/domain/reporting-lineage";
import { ingestCompanyFacts } from "@/modules/fundamentals/application/ingest-company-facts";
import { createLiveCompanyFactsSource } from "@/modules/fundamentals/application/live-company-facts-source";
import { SEC_CONCEPT_SELECTION_VERSION } from "@/modules/fundamentals/domain/sec-concept-selection";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getEgressClient } from "@/server/egress/get-egress-client";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Ingiere los hechos XBRL de uno o más emisores del universo constituido.
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto,
 * porque escribe observaciones que después una valuación va a leer. Publicar
 * exige `--apply`.
 *
 *   pnpm fundamentals:ingest --ticker AAPL
 *   pnpm fundamentals:ingest --ticker AAPL --ticker JPM --apply
 *   pnpm fundamentals:ingest --cik 320193 --apply
 *
 * El ticker se resuelve contra el grafo persistido y nunca se manda a la SEC: lo
 * que sale por la red es el CIK que el universo ya asignó. Si el emisor tiene
 * antecesores de reporte registrados (`pnpm corporate-actions:record`), sus CIK se
 * ingieren también, cada uno en su propia corrida y con su propio sujeto: la
 * historia se une en la lectura, no acá. Todas las llamadas de la corrida
 * comparten un mismo ritmo —2 requests/s, de a una— y un presupuesto.
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
  const assignment =
    resolution.status === "resolved"
      ? state.graph.identifierAssignments.find(
          (candidate) =>
            candidate.identifierType === "cik" &&
            candidate.subjectType === "legal_entity" &&
            candidate.subjectId === resolution.legalEntityId,
        )
      : undefined;

  if (assignment === undefined) {
    console.error(
      `${ticker}: no resuelve a un emisor con CIK en el universo (${resolution.status}).`,
    );
    process.exit(2);
  }

  targets.push({ label: ticker, cik: assignment.normalizedValue });

  const lineage = resolveReportingLineage(
    relationships,
    assignment.subjectId,
    cutoff,
  );

  for (const segment of lineage.segments.slice(1)) {
    const predecessorCik = cikByEntity.get(segment.legalEntityId);

    if (predecessorCik === undefined) {
      console.error(
        `${ticker}: el antecesor ${segment.legalEntityId} no tiene CIK en el grafo.`,
      );
      process.exit(2);
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

const egress = getEgressClient();
const paced = createPacedEgressFetch(
  (async (request) => {
    const response = await egress(request);

    return {
      status: response.status,
      body: response.body,
      byteLength: response.byteLength,
      fetchedAt: response.fetchedAt,
      retryAfter: response.retryAfter,
    };
  }) satisfies EgressFetch,
  SEC_REQUEST_PACING,
  {
    elapsedMs: () => performance.now(),
    sleep: (ms) => sleep(ms),
  },
);

const dependencies = {
  sourceRegistry: registry,
  ingestionRuns: getIngestionRunRepository(),
  sourceDocuments: getSourceDocumentRepository(),
  observations: getObservationRepository(),
  identity,
  source: createLiveCompanyFactsSource({ fetch: paced }),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
};

log("selección", SEC_CONCEPT_SELECTION_VERSION);

for (const target of targets) {
  const startedAt = performance.now();
  const outcome = await ingestCompanyFacts(
    { cik: target.cik, mode: "personal", dryRun: DRY_RUN },
    dependencies,
  );

  console.log("");
  log(target.label, `CIK ${target.cik}`);
  log("  corrida", `${outcome.run.status} ${outcome.run.runId}`);
  log("  flags", outcome.run.qualityFlags.join(", ") || "—");

  if (outcome.run.failure !== null) {
    log(
      "  falla",
      `${outcome.run.failure.code}: ${outcome.run.failure.message}`,
    );
  }

  for (const document of outcome.documents) {
    log(`  ${document.kind}`, `${document.byteLength} bytes`);
  }

  if (outcome.wire !== null) {
    log(
      "  conceptos",
      `${outcome.wire.counts.selectedConcepts}/${outcome.wire.counts.concepts}`,
    );
    log(
      "  puntos",
      `${outcome.wire.counts.selectedPoints}/${outcome.wire.counts.points}`,
    );
    log("  presentaciones", outcome.wire.filings);
    log(
      "  filas rechazadas (cable)",
      outcome.wire.filingRowRejections + outcome.wire.factRowRejections,
    );
  }

  if (outcome.vintages !== null) {
    log("  vintages", outcome.vintages.vintages);
    log("  re-expresiones", outcome.vintages.restated);
    log("  re-reportes colapsados", outcome.vintages.repeats);
    log("  disponibilidad inferida", outcome.vintages.inferredAvailability);
  }

  const byCode = new Map<string, number>();
  for (const rejection of outcome.rejections) {
    byCode.set(rejection.code, (byCode.get(rejection.code) ?? 0) + 1);
  }
  for (const [code, count] of byCode) {
    log(`  rechazo ${code}`, count);
  }

  if (outcome.sourceDocuments !== null) {
    log(
      "  documentos",
      `${outcome.sourceDocuments.inserted.length} nuevos, ${outcome.sourceDocuments.unchanged.length} sin cambios, ${outcome.sourceDocuments.conflicts.length} en conflicto`,
    );
  }

  if (outcome.publication !== null) {
    log("  publicadas", outcome.publication.published);
    log("  duplicadas", outcome.publication.duplicates);
    for (const [code, count] of Object.entries(
      outcome.publication.rejections,
    )) {
      log(`  rechazo publicación ${code}`, count);
    }
  }

  log("  segundos", ((performance.now() - startedAt) / 1000).toFixed(1));
}

console.log("");
log("requests a la SEC", paced.requestCount());

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para publicar.");
}

process.exit(0);
