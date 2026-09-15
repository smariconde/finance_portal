import { describe, expect, it, vi } from "vitest";

import { buildSubmissionsUrl } from "@/modules/fundamentals/application/live-company-facts-source";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { createInMemorySourceDocumentRepository } from "@/modules/observations/infrastructure/in-memory-source-document-repository";
import { ASSIGNMENTS_URL } from "@/modules/universe/application/live-universe-source";
import type { CompanyTickerAssignment } from "@/modules/universe/domain/universe-source-records";

import type { SecListingIndex } from "../domain/parse-sec-listing-index";
import {
  buildFixtureListingGraph,
  FIXTURE_LISTING_ACCESSIONS,
  FIXTURE_LISTING_ASSIGNMENTS,
  FIXTURE_LISTING_FILERS,
  FIXTURE_LISTINGS_FETCHED_AT,
  FIXTURE_RENAMED_TO,
  fixtureIds,
  fixtureListingIndex,
  fixtureSubmissionsPayload,
} from "../infrastructure/fixture-listing-events";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";
import { createLiveListingEvidenceSource } from "./live-listing-evidence-source";
import {
  LISTING_PIPELINE,
  reconcileListings,
  type ReconcileListingsOutcome,
} from "./reconcile-listings";

const CLOCK = "2025-09-20T18:00:05.000Z";

function createIds() {
  let sequence = 0;

  return () => {
    sequence += 1;

    return `00000000-0000-4000-8000-7${String(sequence).padStart(11, "0")}`;
  };
}

type FilerKey = keyof typeof FIXTURE_LISTING_FILERS;

function tickersPayload(assignments: readonly CompanyTickerAssignment[]) {
  return {
    fields: ["cik", "name", "ticker", "exchange"],
    data: assignments.map((row) => [
      Number(row.cik),
      row.name,
      row.ticker,
      row.exchange,
    ]),
  };
}

function harness(
  options: {
    registry?: typeof DEMO_SOURCE_REGISTRY;
    indexes?: Partial<Record<FilerKey, SecListingIndex | string>>;
  } = {},
) {
  const encoder = new TextEncoder();
  const bodies = new Map<string, unknown>([
    [ASSIGNMENTS_URL, tickersPayload(FIXTURE_LISTING_ASSIGNMENTS)],
  ]);

  for (const filer of Object.keys(FIXTURE_LISTING_FILERS) as FilerKey[]) {
    const index = options.indexes?.[filer] ?? fixtureListingIndex(filer);

    bodies.set(
      buildSubmissionsUrl(FIXTURE_LISTING_FILERS[filer].cik),
      typeof index === "string" ? index : fixtureSubmissionsPayload(index),
    );
  }

  const fetch = vi.fn<EgressFetch>(async ({ url }) => {
    const payload = bodies.get(url);
    const body = encoder.encode(
      typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
    );

    return {
      status: payload === undefined ? 404 : 200,
      body,
      byteLength: body.byteLength,
      fetchedAt: FIXTURE_LISTINGS_FETCHED_AT,
    };
  });
  const corporateActions = createInMemoryCorporateActionRepository({
    graph: buildFixtureListingGraph(),
  });
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const sourceDocuments = createInMemorySourceDocumentRepository();
  const dependencies = {
    sourceRegistry: createInMemorySourceRegistryRepository(
      options.registry ?? DEMO_SOURCE_REGISTRY,
    ),
    ingestionRuns,
    sourceDocuments,
    corporateActions,
    loadIdentityGraph: corporateActions.loadIdentityGraph,
    source: createLiveListingEvidenceSource({ fetch }),
    now: () => CLOCK,
    newId: createIds(),
  };

  return {
    fetch,
    corporateActions,
    ingestionRuns,
    sourceDocuments,
    reconcile(
      overrides: { dryRun?: boolean; requestedCiks?: string[] } = {},
    ): Promise<ReconcileListingsOutcome> {
      return reconcileListings(
        { mode: "personal", ...overrides },
        dependencies,
      );
    },
  };
}

function byCik(outcome: ReconcileListingsOutcome, filer: FilerKey) {
  return outcome.filers.find(
    (entry) => entry.cik === FIXTURE_LISTING_FILERS[filer].cik,
  );
}

describe("reconciliación de listings", () => {
  it("evalúa derechos antes de tocar la red", async () => {
    const blocked = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "sec-edgar"
        ? sourceRegistryEntrySchema.parse({
            ...entry,
            rights: { ...entry.rights, automatedAccess: "unknown" },
          })
        : entry,
    );
    const { fetch, reconcile, ingestionRuns } = harness({ registry: blocked });
    const outcome = await reconcile();

    expect(fetch).not.toHaveBeenCalled();
    expect(outcome.rejection).toMatchObject({
      status: "failed",
      failure: { code: "rights_not_approved" },
    });
    expect(await ingestionRuns.list({ sourceId: "sec-edgar" })).toHaveLength(1);
  });

  it("en dry run verifica y planifica sin escribir nada", async () => {
    const { reconcile, ingestionRuns, corporateActions, sourceDocuments } =
      harness();
    const outcome = await reconcile({
      dryRun: true,
      requestedCiks: [FIXTURE_LISTING_FILERS.delisting.cik],
    });

    expect(outcome.filers.map((filer) => filer.run.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "quarantined",
    ]);
    expect(outcome.filers.every((filer) => !filer.persisted)).toBe(true);
    expect(await ingestionRuns.list({ sourceId: "sec-edgar" })).toEqual([]);
    expect(await corporateActions.listCorporateActions()).toEqual([]);
    expect(
      await sourceDocuments.findByIds({
        sourceId: "sec-edgar",
        sourceDocumentIds: [FIXTURE_LISTING_ACCESSIONS.transferCertification],
      }),
    ).toEqual([]);
  });

  it("registra traspaso, delisting pedido y renombre; nombra el ticker sin fecha", async () => {
    const { reconcile, corporateActions, sourceDocuments, fetch } = harness();
    const outcome = await reconcile({
      requestedCiks: [FIXTURE_LISTING_FILERS.delisting.cik],
    });

    // Una tabla y un índice por filer que diverge o que se pidió: nada más.
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(byCik(outcome, "transfer")).toMatchObject({
      persisted: true,
      run: {
        status: "succeeded",
        subjectKey: FIXTURE_LISTING_FILERS.transfer.cik,
        parserVersion: LISTING_PIPELINE.parserVersion,
        datasetId: "sec.submissions",
      },
      applied: { closures: 2, listings: 1, listingSymbols: 1 },
      sourceDocuments: { inserted: expect.any(Array) },
    });
    expect(byCik(outcome, "transfer")!.sourceDocuments!.inserted).toHaveLength(
      4,
    );
    expect(byCik(outcome, "delisting")).toMatchObject({
      run: { status: "succeeded" },
      applied: { closures: 2, listings: 0, corporateActions: 1 },
    });
    expect(byCik(outcome, "rename")).toMatchObject({
      run: {
        status: "succeeded",
        qualityFlags: ["rename_corrects_recorded_version"],
      },
      applied: { supersessions: 1, legalEntities: 1, corporateActions: 0 },
    });
    expect(byCik(outcome, "symbolChange")).toMatchObject({
      persisted: true,
      run: {
        status: "quarantined",
        qualityFlags: ["listing_symbol_change_without_dated_evidence"],
      },
      applied: null,
    });
    expect(byCik(outcome, "twoClasses")).toBeUndefined();

    const graph = await corporateActions.loadIdentityGraph();
    const transferIds = fixtureIds(FIXTURE_LISTING_FILERS.transfer);
    const delistingIds = fixtureIds(FIXTURE_LISTING_FILERS.delisting);

    expect(
      graph.listings.filter(
        (listing) => listing.securityId === transferIds.securityId,
      ),
    ).toMatchObject([{ mic: "XNYS" }]);
    // El delisting cierra el listing; la security sigue vigente.
    expect(
      graph.listings.some(
        (listing) => listing.securityId === delistingIds.securityId,
      ),
    ).toBe(false);
    expect(
      graph.securities.some(
        (security) => security.securityId === delistingIds.securityId,
      ),
    ).toBe(true);
    expect(
      graph.legalEntities.find(
        (entity) =>
          entity.legalEntityId ===
          fixtureIds(FIXTURE_LISTING_FILERS.rename).legalEntityId,
      )!.legalName,
    ).toBe(FIXTURE_RENAMED_TO);
    expect(
      (await corporateActions.listCorporateActions()).map(
        (action) => action.actionType,
      ),
    ).toEqual(["listing_transfer", "delisting"]);
    expect(
      await sourceDocuments.findByIds({
        sourceId: "sec-edgar",
        sourceDocumentIds: [FIXTURE_LISTING_ACCESSIONS.delistingStrike],
      }),
    ).toMatchObject([{ documentType: "25-NSE", subjectType: "legal_entity" }]);
  });

  it("una segunda corrida no encuentra nada que cambiar", async () => {
    const { reconcile, corporateActions } = harness();

    await reconcile({ requestedCiks: [FIXTURE_LISTING_FILERS.delisting.cik] });
    const before = corporateActions.snapshotGraph();
    const again = await reconcile({
      requestedCiks: [FIXTURE_LISTING_FILERS.delisting.cik],
    });

    // Sólo queda la pregunta que la SEC no responde; el delisting pedido ya no
    // tiene listing vigente que verificar.
    expect(again.divergences.map((divergence) => divergence.kind)).toEqual([
      "symbol_changed",
    ]);
    expect(again.requestedNotInGraph).toEqual([
      FIXTURE_LISTING_FILERS.delisting.cik,
    ]);
    expect(corporateActions.snapshotGraph()).toEqual(before);
  });

  it("cuarentena el índice que no se entiende sin tocar a los demás", async () => {
    const { reconcile, corporateActions } = harness({
      indexes: { transfer: "{ no es json" },
    });
    const outcome = await reconcile();

    expect(byCik(outcome, "transfer")).toMatchObject({
      run: {
        status: "quarantined",
        qualityFlags: ["submissions_payload_schema_invalid"],
      },
      plan: null,
    });
    expect(byCik(outcome, "rename")!.run.status).toBe("succeeded");
    expect(
      (await corporateActions.listCorporateActions()).some(
        (action) => action.actionType === "listing_transfer",
      ),
    ).toBe(false);
  });

  it("una verificación pedida sin evento deja una corrida vacía", async () => {
    const { reconcile } = harness({
      indexes: {
        delisting: fixtureListingIndex("delisting", { filings: [] }),
      },
    });
    const outcome = await reconcile({
      requestedCiks: [
        FIXTURE_LISTING_FILERS.delisting.cik,
        FIXTURE_LISTING_FILERS.twoClasses.cik,
      ],
    });

    expect(byCik(outcome, "delisting")).toMatchObject({
      run: { status: "empty", counts: { fetched: 0 } },
      applied: null,
    });
    // Dos clases en el mismo mercado: ni siquiera se busca el `25-NSE`.
    expect(byCik(outcome, "twoClasses")).toMatchObject({
      run: {
        status: "quarantined",
        qualityFlags: ["listing_ambiguous_listing"],
      },
    });
  });
});
