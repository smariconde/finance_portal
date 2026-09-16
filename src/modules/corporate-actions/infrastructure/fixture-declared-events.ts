/** Synthetic evidence: shape measured against SEC, no captured values or payload. */
import type {
  DeclaredAcquisition,
  DeclaredSymbolChange,
} from "../domain/declared-event";
import type { DeclaredEventEvidence } from "../domain/plan-declared-event";
import {
  FIXTURE_LISTING_ASSIGNMENTS,
  fixtureListingFiling,
  fixtureListingIndex,
} from "./fixture-listing-events";

export const DECLARED_EVENT_CLOCK = "2025-09-20T18:00:05.000Z";
export const FIXTURE_ACQUISITION: DeclaredAcquisition = {
  kind: "acquisition",
  acquiredCik: "0000000082",
  acquirerCik: "0000000083",
  acquiredClosingAccession: "0000000900-25-000001",
  acquirerClosingAccession: "0000000900-25-000002",
  sharedCommunicationAccession: "0000000900-25-000003",
  effectiveOn: "2025-09-17",
  decidedAt: "2025-09-20T17:00:00.000Z",
  decidedBy: "owner",
  rationale:
    "Declaración sintética de compra integral; sin continuidad de reporte.",
};
export const FIXTURE_SYMBOL_CHANGE: DeclaredSymbolChange = {
  kind: "symbol_change",
  cik: "0000000085",
  mic: "XNYS",
  fromSymbol: "OLDT",
  toSymbol: "NEWT",
  effectiveOn: "2025-09-12",
  decidedAt: "2025-09-20T17:00:00.000Z",
  decidedBy: "owner",
  rationale:
    "Declaración sintética del cambio de símbolo del mismo instrumento.",
};
export function acquisitionEvidence(): Extract<
  DeclaredEventEvidence,
  { kind: "acquisition" }
> {
  const d = FIXTURE_ACQUISITION;
  const shared = fixtureListingFiling(
    d.sharedCommunicationAccession,
    "425",
    "2025-09-10T20:00:00.000Z",
  );
  return {
    kind: "acquisition",
    fetchedAt: "2025-09-20T18:00:00.000Z",
    acquired: fixtureListingIndex("delisting", {
      filings: [
        shared,
        fixtureListingFiling(
          d.acquiredClosingAccession,
          "8-K",
          "2025-09-17T20:01:44.000Z",
          ["2.01", "3.01", "5.01"],
          d.effectiveOn,
        ),
      ],
    }),
    acquirer: fixtureListingIndex("rename", {
      filings: [
        shared,
        fixtureListingFiling(
          d.acquirerClosingAccession,
          "8-K",
          "2025-09-17T20:01:49.000Z",
          ["2.01", "5.03"],
          d.effectiveOn,
        ),
      ],
    }),
  };
}
export function symbolEvidence(): Extract<
  DeclaredEventEvidence,
  { kind: "symbol_change" }
> {
  return {
    kind: "symbol_change",
    assignments: FIXTURE_LISTING_ASSIGNMENTS,
    fetchedAt: "2025-09-20T18:00:00.000Z",
  };
}
