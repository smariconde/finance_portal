import { describe, expect, it } from "vitest";

import {
  buildFixtureListingGraph,
  FIXTURE_DELISTING_EFFECTIVE_AT,
  FIXTURE_LISTING_ACCESSIONS,
  FIXTURE_LISTING_ASSIGNMENTS,
  FIXTURE_LISTING_FILERS,
  FIXTURE_LISTINGS_FETCHED_AT,
  FIXTURE_RENAME_BORDER,
  FIXTURE_RENAMED_TO,
  FIXTURE_TRANSFER_EFFECTIVE_AT,
  fixtureListingFiling as filing,
  fixtureListingIndex,
} from "../infrastructure/fixture-listing-events";

import {
  detectListingDivergences,
  type RecordedEntity,
} from "./detect-listing-divergences";
import type { SecListingIndex } from "./parse-sec-listing-index";
import {
  verifyListingCandidate,
  type ListingCandidate,
  type ListingVerification,
} from "./verify-listing-evidence";

const { entities, divergences } = detectListingDivergences({
  graph: buildFixtureListingGraph(),
  assignments: FIXTURE_LISTING_ASSIGNMENTS,
});

type FilerKey = keyof typeof FIXTURE_LISTING_FILERS;

function entity(filer: FilerKey): RecordedEntity {
  return entities.get(FIXTURE_LISTING_FILERS[filer].cik)!;
}

function divergence(filer: FilerKey): ListingCandidate {
  return divergences.find(
    (candidate) => candidate.cik === FIXTURE_LISTING_FILERS[filer].cik,
  )!;
}

function requested(filer: FilerKey, index = 0): ListingCandidate {
  const recorded = entity(filer);

  return {
    kind: "check_requested",
    cik: recorded.cik,
    legalEntityId: recorded.legalEntityId,
    listing: recorded.listings[index]!,
  };
}

function verify(
  candidate: ListingCandidate,
  index: SecListingIndex,
): ListingVerification {
  return verifyListingCandidate({
    candidate,
    entity: entities.get(candidate.cik)!,
    index,
    fetchedAt: FIXTURE_LISTINGS_FETCHED_AT,
  });
}

const a = FIXTURE_LISTING_ACCESSIONS;

describe("evidencia de un traspaso de mercado", () => {
  it("confirma con retiro, registro y certificación del mercado nuevo", () => {
    const result = verify(
      divergence("transfer"),
      fixtureListingIndex("transfer"),
    );

    expect(result).toMatchObject({
      status: "verified",
      change: {
        kind: "listing_transfer",
        toVenue: { mic: "XNYS" },
        // La evidencia queda completa con el `CERT` de la mañana siguiente.
        effectiveAt: FIXTURE_TRANSFER_EFFECTIVE_AT,
        evidence: {
          withdrawal: { accessionNumber: a.transferWithdrawal },
          registration: { accessionNumber: a.transferRegistration },
          certification: { accessionNumber: a.transferCertification },
          // El aviso es anterior a la constitución y aun así se encuentra.
          notice: { accessionNumber: a.transferNotice },
        },
      },
    });
  });

  it("no toma una emisión de deuda —registro y certificación sin retiro— por traspaso", () => {
    const result = verify(
      divergence("transfer"),
      fixtureListingIndex("transfer", {
        filings: [
          filing(a.debtRegistration, "8-A12B", "2025-09-10T20:27:15.000Z"),
          filing(a.debtCertification, "CERT", "2025-09-11T20:02:29.000Z"),
          filing(a.transferCertification, "CERT", "2025-09-11T20:02:30.000Z"),
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "rejected",
      code: "transfer_withdrawal_not_found",
    });
  });

  it("exige que la certificación la presente el mercado de destino", () => {
    const index = fixtureListingIndex("transfer");
    const result = verify(divergence("transfer"), {
      ...index,
      filings: index.filings.filter(
        (entry) => entry.accessionNumber !== a.transferCertification,
      ),
    });

    expect(result).toMatchObject({
      status: "rejected",
      code: "transfer_certification_not_found",
    });
  });

  it("ignora la evidencia anterior a lo que el grafo registró", () => {
    const early = fixtureListingIndex("transfer", {
      filings: [
        filing(a.transferRegistration, "8-A12B", "2025-09-01T20:03:41.000Z"),
        filing(a.transferWithdrawal, "25", "2025-09-01T20:04:14.000Z"),
        filing(a.transferCertification, "CERT", "2025-09-02T12:44:23.000Z"),
      ],
    });

    expect(verify(divergence("transfer"), early)).toMatchObject({
      status: "rejected",
      code: "transfer_withdrawal_not_found",
    });
  });

  it("rechaza sin mirar si el índice reciente no alcanza lo registrado", () => {
    const index = fixtureListingIndex("transfer");

    expect(
      verify(divergence("transfer"), {
        ...index,
        coverage: {
          oldestAcceptedAt: "2025-09-06T00:00:00.000Z",
          hasHistoryFiles: true,
        },
      }),
    ).toMatchObject({
      status: "rejected",
      code: "evidence_window_not_covered",
    });
  });
});

describe("evidencia de un delisting", () => {
  it("confirma con el `25-NSE` del mercado y el aviso 3.01 del mismo día", () => {
    const result = verify(
      requested("delisting"),
      fixtureListingIndex("delisting"),
    );

    expect(result).toMatchObject({
      status: "verified",
      change: {
        kind: "delisting",
        // El aviso llegó cinco horas después: ahí queda confirmado.
        effectiveAt: FIXTURE_DELISTING_EFFECTIVE_AT,
        reason: "change_in_control_completed",
        evidence: {
          strike: { accessionNumber: a.delistingStrike },
          notice: { accessionNumber: a.delistingNotice },
        },
      },
    });
  });

  it("no deslista por un `25-NSE` sin aviso: retiró otra clase", () => {
    const result = verify(
      requested("delisting"),
      fixtureListingIndex("delisting", {
        filings: [
          filing(a.unrelatedStrike, "25-NSE", "2025-09-12T20:13:28.000Z"),
          filing("0000000082-25-000098", "8-K", "2025-09-20T20:06:52.000Z", [
            "5.07",
          ]),
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "rejected",
      code: "delisting_notice_not_found",
    });
  });

  it("un aviso con ítems ilegibles no cuenta como 3.01", () => {
    const index = fixtureListingIndex("delisting");

    expect(
      verify(requested("delisting"), {
        ...index,
        filings: index.filings.map((entry) =>
          entry.form === "8-K" ? { ...entry, items: null } : entry,
        ),
      }),
    ).toMatchObject({ status: "rejected", code: "delisting_notice_not_found" });
  });

  it("sólo lee el `25-NSE` del mercado donde cotiza el listing", () => {
    const index = fixtureListingIndex("delisting");
    const fromNasdaq = {
      ...index,
      filings: index.filings.map((entry) =>
        entry.form === "25-NSE"
          ? {
              ...entry,
              accessionNumber: "0001354457-25-000689",
              submitterCik: "0001354457",
            }
          : entry,
      ),
    };

    expect(verify(requested("delisting"), fromNasdaq)).toEqual({
      status: "no_event",
      candidate: requested("delisting"),
    });
  });

  it("una verificación pedida sin evento no es un rechazo; una divergencia sí", () => {
    const quiet = fixtureListingIndex("symbolChange");

    expect(verify(requested("symbolChange"), quiet).status).toBe("no_event");

    const recorded = entity("symbolChange");
    const unassigned: ListingCandidate = {
      kind: "listing_unassigned",
      cik: recorded.cik,
      legalEntityId: recorded.legalEntityId,
      listing: recorded.listings[0]!,
    };

    expect(verify(unassigned, quiet)).toMatchObject({
      status: "rejected",
      code: "delisting_strike_not_found",
    });
  });

  it("no elige entre dos clases del mismo emisor en el mismo mercado", () => {
    expect(
      verify(requested("twoClasses"), fixtureListingIndex("twoClasses")),
    ).toMatchObject({ status: "rejected", code: "ambiguous_listing" });
  });
});

describe("renombres y tickers", () => {
  it("corrige una versión que nació con el nombre vencido", () => {
    const result = verify(divergence("rename"), fixtureListingIndex("rename"));

    expect(result).toMatchObject({
      status: "verified",
      change: {
        kind: "rename",
        newName: FIXTURE_RENAMED_TO,
        effectiveAt: FIXTURE_RENAME_BORDER,
        availableAt: FIXTURE_LISTINGS_FETCHED_AT,
        mode: "correction",
      },
    });
  });

  it("cierra la versión cuando el renombre es posterior a lo registrado", () => {
    const result = verify(
      divergence("rename"),
      fixtureListingIndex("rename", {
        formerNames: [
          {
            name: "NOMBRE VIEJO SINTETICO INC",
            from: null,
            to: "2025-09-12T04:00:00.000Z",
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "verified",
      change: { mode: "closure", effectiveAt: "2025-09-12T04:00:00.000Z" },
    });
  });

  it("exige que el índice confirme el nombre nuevo y registre el viejo", () => {
    expect(
      verify(
        divergence("rename"),
        fixtureListingIndex("rename", { entityName: "OTRO" }),
      ),
    ).toMatchObject({ code: "current_name_not_confirmed" });
    expect(
      verify(
        divergence("rename"),
        fixtureListingIndex("rename", { formerNames: [] }),
      ),
    ).toMatchObject({ code: "former_name_not_found" });
  });

  it("no fecha un cambio de ticker que la SEC no fecha", () => {
    expect(
      verify(divergence("symbolChange"), fixtureListingIndex("symbolChange")),
    ).toMatchObject({
      status: "rejected",
      code: "symbol_change_without_dated_evidence",
    });
  });

  it("rechaza un índice de otro filer", () => {
    expect(
      verify(divergence("rename"), fixtureListingIndex("transfer")),
    ).toMatchObject({ status: "rejected", code: "subject_mismatch" });
  });
});
