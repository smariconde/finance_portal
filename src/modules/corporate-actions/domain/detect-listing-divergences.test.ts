import { describe, expect, it } from "vitest";

import {
  buildFixtureListingGraph,
  FIXTURE_LISTING_ASSIGNMENTS,
  FIXTURE_LISTING_FILERS,
  FIXTURE_RENAMED_TO,
} from "../infrastructure/fixture-listing-events";

import {
  collectRecordedEntities,
  detectListingDivergences,
} from "./detect-listing-divergences";

const graph = buildFixtureListingGraph();

describe("divergencias entre el grafo y la tabla vigente", () => {
  it("pregunta por el traspaso, el renombre y el ticker; no por lo que coincide", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: FIXTURE_LISTING_ASSIGNMENTS,
    });

    expect(
      divergences.map((divergence) => [divergence.cik, divergence.kind]),
    ).toEqual([
      [FIXTURE_LISTING_FILERS.transfer.cik, "listing_moved"],
      [FIXTURE_LISTING_FILERS.rename.cik, "name_changed"],
      [FIXTURE_LISTING_FILERS.symbolChange.cik, "symbol_changed"],
    ]);

    const [moved, renamed, symbol] = divergences;

    expect(moved).toMatchObject({
      toVenue: { mic: "XNYS", country: "US", quoteCurrency: "USD" },
      toSymbol: "TRSP",
      listing: { mic: "XNAS", symbol: { symbol: "TRSP" } },
    });
    expect(renamed).toMatchObject({ assignedName: FIXTURE_RENAMED_TO });
    expect(symbol).toMatchObject({ toSymbol: "NEWT" });
  });

  it("no detecta una salida mientras la tabla siga mostrándola", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: FIXTURE_LISTING_ASSIGNMENTS,
    });

    expect(
      divergences.some(
        (divergence) => divergence.cik === FIXTURE_LISTING_FILERS.delisting.cik,
      ),
    ).toBe(false);
  });

  it("marca como no asignado lo que desapareció de la tabla o pasó a OTC", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: FIXTURE_LISTING_ASSIGNMENTS.flatMap((row) =>
        row.cik === "82"
          ? []
          : row.cik === "81"
            ? [{ ...row, exchange: "OTC" }]
            : [row],
      ),
    });

    expect(
      divergences
        .filter((divergence) => divergence.kind === "listing_unassigned")
        .map((divergence) => divergence.cik),
    ).toEqual([
      FIXTURE_LISTING_FILERS.transfer.cik,
      FIXTURE_LISTING_FILERS.delisting.cik,
    ]);
  });

  it("empareja una mudanza que además cambia de ticker", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: FIXTURE_LISTING_ASSIGNMENTS.map((row) =>
        row.cik === "81" ? { ...row, ticker: "TRSX" } : row,
      ),
    });

    expect(divergences[0]).toMatchObject({
      kind: "listing_moved",
      toVenue: { mic: "XNYS" },
      toSymbol: "TRSX",
    });
  });

  it("no empareja un ticker cuando el mercado tiene más de un candidato", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: [
        ...FIXTURE_LISTING_ASSIGNMENTS,
        // Una preferida en el mismo mercado: la tabla de la SEC las publica.
        {
          cik: "85",
          name: "TICKER SINTETICO CO",
          ticker: "NEWT-PA",
          exchange: "NYSE",
        },
      ],
    });

    expect(
      divergences.find(
        (divergence) =>
          divergence.cik === FIXTURE_LISTING_FILERS.symbolChange.cik,
      ),
    ).toMatchObject({ kind: "listing_unassigned" });
  });

  it("no pregunta por un nombre cuando la tabla trae dos para el mismo CIK", () => {
    const { divergences } = detectListingDivergences({
      graph,
      assignments: [
        ...FIXTURE_LISTING_ASSIGNMENTS,
        { cik: "83", name: "OTRO NOMBRE", ticker: "NMBR-W", exchange: "OTC" },
      ],
    });

    expect(
      divergences.some((divergence) => divergence.kind === "name_changed"),
    ).toBe(false);
  });

  it("deja afuera a una entidad sin listings, como un antecesor de sucesión", () => {
    const withoutListings = {
      ...graph,
      listings: graph.listings.filter(
        (listing) => !listing.listingId.includes("-1a82"),
      ),
    };

    expect(
      collectRecordedEntities(withoutListings).has(
        FIXTURE_LISTING_FILERS.delisting.cik,
      ),
    ).toBe(false);
    expect(collectRecordedEntities(graph).size).toBe(5);
  });
});
