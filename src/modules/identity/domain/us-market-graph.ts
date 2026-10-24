import type { IdentityGraph } from "./identity-graph";

/**
 * Ticker-driven US equity workflows declare their market scope. The complete
 * resolver still reports ambiguity for an unqualified US/BYMA ticker collision.
 * Identifiers and instruments retain their own identities in the full graph.
 */
export function usMarketGraph(graph: IdentityGraph): IdentityGraph {
  const listings = graph.listings.filter((listing) => listing.country === "US");
  const ids = new Set(listings.map((listing) => listing.listingId));
  return {
    ...graph,
    listings,
    listingSymbols: graph.listingSymbols.filter((symbol) =>
      ids.has(symbol.listingId),
    ),
  };
}
