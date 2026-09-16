import { describe, expect, it } from "vitest";

import { StaleListingPlanError } from "../application/corporate-action-repository";
import {
  buildFixtureListingGraph,
  FIXTURE_DELISTING_EFFECTIVE_AT,
  FIXTURE_LISTING_ACCESSIONS,
  FIXTURE_LISTING_ASSIGNMENTS,
  FIXTURE_LISTING_FILERS,
  FIXTURE_LISTINGS_CONSTITUTED_AT,
  FIXTURE_LISTINGS_FETCHED_AT,
  FIXTURE_RENAME_BORDER,
  FIXTURE_RENAMED_TO,
  FIXTURE_TRANSFER_EFFECTIVE_AT,
  fixtureIds,
  fixtureListingIndex,
} from "../infrastructure/fixture-listing-events";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";

import { detectListingDivergences } from "./detect-listing-divergences";
import {
  newYorkDate,
  planListingReconciliation,
} from "./plan-listing-reconciliation";
import {
  verifyListingCandidate,
  type ListingCandidate,
  type VerifiedListingChange,
} from "./verify-listing-evidence";

const RECORDED_AT = "2025-09-20T18:00:05.000Z";
const graph = buildFixtureListingGraph();
const { entities, divergences } = detectListingDivergences({
  graph,
  assignments: FIXTURE_LISTING_ASSIGNMENTS,
});

function idFactory(): () => string {
  let counter = 0;

  return () => {
    counter += 1;

    return `00000000-0000-4000-8000-9${String(counter).padStart(11, "0")}`;
  };
}

type FilerKey = keyof typeof FIXTURE_LISTING_FILERS;

function verified(filer: FilerKey): VerifiedListingChange {
  const { cik } = FIXTURE_LISTING_FILERS[filer];
  const entity = entities.get(cik)!;
  const candidate: ListingCandidate = divergences.find(
    (entry) => entry.cik === cik,
  ) ?? {
    kind: "check_requested",
    cik,
    legalEntityId: entity.legalEntityId,
    listing: entity.listings[0]!,
  };
  const result = verifyListingCandidate({
    candidate,
    entity,
    index: fixtureListingIndex(filer),
    fetchedAt: FIXTURE_LISTINGS_FETCHED_AT,
  });

  if (result.status !== "verified") {
    throw new Error(`fixture ${filer} did not verify`);
  }

  return result.change;
}

function plan(filer: FilerKey, corporateActions = [] as const) {
  const change = verified(filer);

  return planListingReconciliation({
    cik: change.cik,
    legalEntityId: change.legalEntityId,
    changes: [change],
    corporateActions,
    recordedAt: RECORDED_AT,
    newId: idFactory(),
  });
}

describe("plan de eventos de listing", () => {
  it("un traspaso cierra listing y ticker y abre otro listing sobre la misma security", () => {
    const transfer = plan("transfer");
    const ids = fixtureIds(FIXTURE_LISTING_FILERS.transfer);

    expect(transfer.status).toBe("planned");
    expect(transfer.closures).toEqual([
      {
        level: "listing",
        subjectId: ids.listingId,
        validFrom: FIXTURE_LISTINGS_CONSTITUTED_AT,
        validTo: FIXTURE_TRANSFER_EFFECTIVE_AT,
      },
      {
        level: "listing_symbol",
        subjectId: ids.listingSymbolId,
        validFrom: FIXTURE_LISTINGS_CONSTITUTED_AT,
        validTo: FIXTURE_TRANSFER_EFFECTIVE_AT,
      },
    ]);
    expect(transfer.listings).toHaveLength(1);
    expect(transfer.listings[0]).toMatchObject({
      securityId: ids.securityId,
      mic: "XNYS",
      validFrom: FIXTURE_TRANSFER_EFFECTIVE_AT,
      availableAt: FIXTURE_TRANSFER_EFFECTIVE_AT,
      sourceDocumentId: FIXTURE_LISTING_ACCESSIONS.transferCertification,
      primaryListing: true,
    });
    expect(transfer.listings[0]!.listingId).not.toBe(ids.listingId);
    expect(transfer.listingSymbols[0]).toMatchObject({
      listingId: transfer.listings[0]!.listingId,
      symbol: "TRSP",
      validFrom: FIXTURE_TRANSFER_EFFECTIVE_AT,
    });
    expect(transfer.corporateActions[0]).toMatchObject({
      actionType: "listing_transfer",
      subjectType: "security",
      subjectId: ids.securityId,
      effectiveOn: "2025-09-09",
      availableAt: FIXTURE_TRANSFER_EFFECTIVE_AT,
      terms: {
        fromMic: "XNAS",
        toMic: "XNYS",
        fromSymbol: "TRSP",
        toSymbol: "TRSP",
        withdrawalAccession: FIXTURE_LISTING_ACCESSIONS.transferWithdrawal,
        registrationAccession: FIXTURE_LISTING_ACCESSIONS.transferRegistration,
        noticeAccession: FIXTURE_LISTING_ACCESSIONS.transferNotice,
      },
    });
    expect(transfer.supersessions).toEqual([]);
  });

  it("un delisting cierra listing y ticker sin abrir nada", () => {
    const delisting = plan("delisting");
    const ids = fixtureIds(FIXTURE_LISTING_FILERS.delisting);

    expect(delisting.closures.map((closure) => closure.level)).toEqual([
      "listing",
      "listing_symbol",
    ]);
    expect(delisting.listings).toEqual([]);
    expect(delisting.corporateActions[0]).toMatchObject({
      actionType: "delisting",
      subjectType: "listing",
      subjectId: ids.listingId,
      availableAt: FIXTURE_DELISTING_EFFECTIVE_AT,
      terms: {
        mic: "XNYS",
        symbol: "SALE",
        noticeAccession: FIXTURE_LISTING_ACCESSIONS.delistingNotice,
        reason: "change_in_control_completed",
      },
    });
  });

  it("un renombre anterior a lo registrado supersede en vez de cerrar en el pasado", () => {
    const rename = plan("rename");
    const { legalEntityId } = fixtureIds(FIXTURE_LISTING_FILERS.rename);

    expect(rename.closures).toEqual([]);
    expect(rename.supersessions).toEqual([
      {
        level: "legal_entity",
        subjectId: legalEntityId,
        validFrom: FIXTURE_LISTINGS_CONSTITUTED_AT,
        supersededAt: FIXTURE_LISTINGS_FETCHED_AT,
      },
    ]);
    expect(rename.legalEntities[0]).toMatchObject({
      legalEntityId,
      legalName: FIXTURE_RENAMED_TO,
      validFrom: FIXTURE_RENAME_BORDER,
      availableAt: FIXTURE_LISTINGS_FETCHED_AT,
      sourceDocumentId: "submissions/CIK0000000083.json",
    });
    // Un renombre no es un evento con presentación propia.
    expect(rename.corporateActions).toEqual([]);
  });

  it("no vuelve a registrar una presentación ya descrita", () => {
    const first = plan("transfer");
    const again = planListingReconciliation({
      cik: first.cik,
      legalEntityId: first.legalEntityId,
      changes: [verified("transfer")],
      corporateActions: first.corporateActions,
      recordedAt: RECORDED_AT,
      newId: idFactory(),
    });

    expect(again.status).toBe("unchanged");
    expect(again.rejections.map((rejection) => rejection.code)).toEqual([
      "listing_event_already_recorded",
    ]);
  });

  it("rechaza un borde que no es posterior al intervalo que cerraría", () => {
    const change = verified("delisting");
    const stale = planListingReconciliation({
      cik: change.cik,
      legalEntityId: change.legalEntityId,
      changes: [
        { ...change, effectiveAt: FIXTURE_LISTINGS_CONSTITUTED_AT },
      ] as VerifiedListingChange[],
      corporateActions: [],
      recordedAt: RECORDED_AT,
      newId: idFactory(),
    });

    expect(stale.status).toBe("unchanged");
    expect(stale.closures).toEqual([]);
    expect(stale.rejections[0]!.code).toBe("stale_effective_date");
  });

  it("fecha el evento en el calendario de Nueva York, no en UTC", () => {
    expect(newYorkDate("2025-09-18T02:30:00.000Z")).toBe("2025-09-17");
    expect(newYorkDate("2025-12-18T04:30:00.000Z")).toBe("2025-12-17");
  });
});

describe("aplicar un plan de listings en el doble", () => {
  it("deja una sola security con un solo listing vigente y la historia intacta", async () => {
    const repository = createInMemoryCorporateActionRepository({ graph });
    const transfer = plan("transfer");

    await expect(repository.applyListingPlan(transfer)).resolves.toEqual({
      closures: 2,
      supersessions: 0,
      legalEntities: 0,
      listings: 1,
      listingSymbols: 1,
      corporateActions: 1,
    });

    const { securityId } = fixtureIds(FIXTURE_LISTING_FILERS.transfer);
    const open = await repository.loadIdentityGraph();
    const all = repository.snapshotGraph();

    expect(
      open.listings.filter((listing) => listing.securityId === securityId),
    ).toMatchObject([{ mic: "XNYS" }]);
    expect(
      all.listings.filter((listing) => listing.securityId === securityId),
    ).toHaveLength(2);

    // El mismo plan otra vez encuentra cerrado lo que tenía que cerrar.
    await expect(repository.applyListingPlan(transfer)).rejects.toBeInstanceOf(
      StaleListingPlanError,
    );
    expect(repository.snapshotGraph().listings).toHaveLength(
      all.listings.length,
    );
  });

  it("una corrección deja la versión vieja superseded y la nueva vigente", async () => {
    const repository = createInMemoryCorporateActionRepository({ graph });

    await repository.applyListingPlan(plan("rename"));

    const { legalEntityId } = fixtureIds(FIXTURE_LISTING_FILERS.rename);
    const versions = repository
      .snapshotGraph()
      .legalEntities.filter((entity) => entity.legalEntityId === legalEntityId);

    expect(
      versions.map((version) => [version.legalName, version.supersededAt]),
    ).toEqual([
      ["NOMBRE VIEJO SINTETICO INC", FIXTURE_LISTINGS_FETCHED_AT],
      [FIXTURE_RENAMED_TO, null],
    ]);
  });
});
