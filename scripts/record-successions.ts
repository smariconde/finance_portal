import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { DECLARED_SUCCESSIONS } from "@/modules/corporate-actions/application/declared-successions";
import { createLiveSuccessionEvidenceSource } from "@/modules/corporate-actions/application/live-succession-evidence-source";
import { recordSuccession } from "@/modules/corporate-actions/application/record-succession";
import {
  createPacedEgressFetch,
  SEC_REQUEST_PACING,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getEgressClient } from "@/server/egress/get-egress-client";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getSourceDocumentRepository } from "@/server/persistence/get-source-document-repository";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";

/**
 * Registra las sucesiones de emisor declaradas en
 * `src/modules/corporate-actions/application/declared-successions.ts`.
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto,
 * porque cambia qué historia ve una valuación. Escribir exige `--apply`.
 *
 *   pnpm corporate-actions:record
 *   pnpm corporate-actions:record --apply
 *
 * Cada declaración se verifica contra los índices de la SEC de los dos filers; lo
 * que no cierra queda en una corrida `quarantined` y no toca el grafo. Después de
 * registrar una sucesión nueva hay que ingerir los hechos del antecesor:
 * `pnpm fundamentals:ingest --ticker <T> --apply` ya lo incluye.
 */
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
  },
});

const DRY_RUN = !values.apply;

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}

const registry = getSourceRegistryRepository();
const sync = await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, registry);

log("registro creado", sync.created.join(", ") || "—");
log("registro actualizado", sync.updated.join(", ") || "—");

const universe = getUniverseRepository();
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
  corporateActions: getCorporateActionRepository(),
  loadIdentityGraph: async () =>
    (await universe.loadState({ indexId: SP500_INDEX_ID })).graph,
  source: createLiveSuccessionEvidenceSource({ fetch: paced }),
  now: () => new Date().toISOString(),
  newId: () => randomUUID(),
};

log("declaraciones", DECLARED_SUCCESSIONS.length);

for (const declaration of DECLARED_SUCCESSIONS) {
  const outcome = await recordSuccession(
    { declaration, mode: "personal", dryRun: DRY_RUN },
    dependencies,
  );

  console.log("");
  log(
    "sucesión",
    `CIK ${declaration.predecessorCik} → CIK ${declaration.successorCik}`,
  );
  log("  presentación", declaration.successionAccession);

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

  if (outcome.rejection !== null) {
    log("  rechazo", outcome.rejection);
  }

  for (const document of outcome.documents) {
    log(
      `  ${document.kind}`,
      `CIK ${document.cik} ${document.byteLength} bytes`,
    );
  }

  if (outcome.evidence !== null) {
    log("  antecesor", outcome.evidence.predecessorName);
    log("  sucesor", outcome.evidence.successorName ?? "—");
    log(
      "  evidencia",
      `${outcome.evidence.successionFiling.form} aceptada ${outcome.evidence.availableAt}`,
    );
    log("  vigencia", outcome.evidence.effectiveOn);
    log(
      "  último reporte antecesor",
      `${outcome.evidence.lastPredecessorReport.form} ${outcome.evidence.lastPredecessorReport.reportDate ?? "—"}`,
    );
  }

  if (outcome.plan !== null) {
    log("  plan", outcome.plan.status);
    log("  antecesor (ID)", outcome.plan.predecessorLegalEntityId ?? "—");
    log("  sucesor (ID)", outcome.plan.successorLegalEntityId ?? "—");
  }

  if (outcome.sourceDocuments !== null) {
    log(
      "  documentos",
      `${outcome.sourceDocuments.inserted.length} nuevos, ${outcome.sourceDocuments.unchanged.length} sin cambios, ${outcome.sourceDocuments.conflicts.length} en conflicto`,
    );
  }

  if (outcome.applied !== null) {
    log(
      "  escrito",
      `${outcome.applied.legalEntities} entidades, ${outcome.applied.identifierAssignments} CIK, ${outcome.applied.corporateActions} eventos, ${outcome.applied.relationships} vínculos`,
    );
  }
}

console.log("");
log("requests a la SEC", paced.requestCount());

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para registrar.");
}

process.exit(0);
