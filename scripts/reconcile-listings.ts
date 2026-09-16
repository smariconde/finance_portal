import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { createLiveListingEvidenceSource } from "@/modules/corporate-actions/application/live-listing-evidence-source";
import { reconcileListings } from "@/modules/corporate-actions/application/reconcile-listings";
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
 * Reconcilia los listings del universo con la evidencia fechada de la SEC:
 * traspasos de mercado, delistings y renombres (ADR 0013).
 *
 * Es un job controlado y no un gate: se corre a mano y en dry run por defecto,
 * porque cierra listings. Escribir exige `--apply`.
 *
 *   pnpm corporate-actions:listings
 *   pnpm corporate-actions:listings --cik 0000712515 --apply
 *
 * Pregunta por lo que la tabla vigente de tickers muestra distinto del grafo,
 * incluido un ticker que desapareció de ella. La tabla no dice cuándo lo sacó, así
 * que `--cik` pide verificar un filer sin esperarla, por ejemplo después de un
 * rebalanceo que sacó a alguien del índice.
 */
const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    cik: { type: "string", multiple: true, default: [] },
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

const outcome = await reconcileListings(
  { mode: "personal", dryRun: DRY_RUN, requestedCiks: values.cik },
  {
    sourceRegistry: registry,
    ingestionRuns: getIngestionRunRepository(),
    sourceDocuments: getSourceDocumentRepository(),
    corporateActions: getCorporateActionRepository(),
    loadIdentityGraph: async () =>
      (await universe.loadState({ indexId: SP500_INDEX_ID })).graph,
    source: createLiveListingEvidenceSource({ fetch: paced }),
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  },
);

if (outcome.rejection !== null) {
  log("rechazo", outcome.rejection.failure?.code ?? outcome.rejection.status);
  process.exit(1);
}

console.log("");
log("tabla de tickers", `${outcome.assignments?.byteLength ?? 0} bytes`);
log("divergencias", outcome.divergences.length);

for (const divergence of outcome.divergences) {
  const detail =
    divergence.kind === "name_changed"
      ? `→ ${divergence.assignedName}`
      : divergence.kind === "listing_moved"
        ? `${divergence.listing.mic}:${divergence.listing.symbol?.symbol ?? "—"} → ${divergence.toVenue.mic}:${divergence.toSymbol}`
        : divergence.kind === "symbol_changed"
          ? `${divergence.listing.mic}:${divergence.listing.symbol?.symbol ?? "—"} → ${divergence.toSymbol}`
          : `${divergence.listing.mic}:${divergence.listing.symbol?.symbol ?? "—"}`;

  log(`  CIK ${divergence.cik}`, `${divergence.kind} ${detail}`);
}

if (outcome.requestedNotInGraph.length > 0) {
  log("pedidos sin listing vigente", outcome.requestedNotInGraph.join(", "));
}

for (const filer of outcome.filers) {
  console.log("");
  log("filer", `CIK ${filer.cik}`);
  log("  corrida", `${filer.run.status} ${filer.run.runId}`);
  log("  flags", filer.run.qualityFlags.join(", ") || "—");

  if (filer.run.failure !== null) {
    log("  falla", `${filer.run.failure.code}: ${filer.run.failure.message}`);
  }

  for (const verification of filer.verifications) {
    if (verification.status === "rejected") {
      log(`  ${verification.candidate.kind}`, `rechazo ${verification.code}`);
      continue;
    }

    if (verification.status === "no_event") {
      log(`  ${verification.candidate.kind}`, "sin evento");
      continue;
    }

    const { change } = verification;

    if (change.kind === "listing_transfer") {
      log(
        "  traspaso",
        `${change.listing.mic} → ${change.toVenue.mic} en ${change.effectiveAt}`,
      );
      log(
        "    evidencia",
        `25 ${change.evidence.withdrawal.accessionNumber}, 8-A12B ${change.evidence.registration.accessionNumber}, CERT ${change.evidence.certification.accessionNumber}`,
      );
      log(
        "    aviso 3.01",
        change.evidence.notice?.accessionNumber ?? "no encontrado",
      );
    } else if (change.kind === "delisting") {
      log(
        "  delisting",
        `${change.listing.mic}:${change.listing.symbol?.symbol ?? "—"} en ${change.effectiveAt} (${change.reason})`,
      );
      log(
        "    evidencia",
        `25-NSE ${change.evidence.strike.accessionNumber}, 8-K ${change.evidence.notice.accessionNumber}`,
      );
    } else {
      log(
        "  renombre",
        `${change.entity.version.legalName} → ${change.newName} desde ${change.effectiveAt} (${change.mode})`,
      );
    }
  }

  for (const rejection of filer.plan?.rejections ?? []) {
    log(`  plan ${rejection.change.kind}`, `rechazo ${rejection.code}`);
  }

  if (filer.sourceDocuments !== null) {
    log(
      "  documentos",
      `${filer.sourceDocuments.inserted.length} nuevos, ${filer.sourceDocuments.unchanged.length} sin cambios, ${filer.sourceDocuments.conflicts.length} en conflicto`,
    );
  }

  if (filer.applied !== null) {
    log(
      "  escrito",
      `${filer.applied.closures} cierres, ${filer.applied.supersessions} supersesiones, ${filer.applied.legalEntities} nombres, ${filer.applied.listings} listings, ${filer.applied.listingSymbols} tickers, ${filer.applied.corporateActions} eventos`,
    );
  }
}

if (outcome.deferred.length > 0) {
  console.log("");
  log("diferidos por techo", outcome.deferred.join(", "));
}

console.log("");
log("requests a la SEC", paced.requestCount());

if (DRY_RUN) {
  console.log("\nDry run: no se escribió nada. Usá --apply para registrar.");
}

process.exit(0);
