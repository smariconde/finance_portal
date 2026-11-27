import type {
  ListingStore,
  StoredListingHistory,
} from "../application/listing-store";
import {
  planListingCapture,
  type StoredListing,
} from "../domain/listing-revisions";

/** Doble de prueba de `ListingStore`: ninguna raíz de composición lo construye. */
export function createInMemoryListingStore(): ListingStore & {
  readonly snapshot: () => readonly StoredListingHistory[];
} {
  const listings = new Map<string, StoredListingHistory>();
  const keyOf = (source: string, externalId: string) =>
    `${source}\u0000${externalId}`;

  const latestOf = (history: StoredListingHistory): StoredListing => ({
    source: history.source,
    externalId: history.externalId,
    canonicalUrl: history.canonicalUrl,
    firstSeenAt: history.firstSeenAt,
    lastSeenAt: history.lastSeenAt,
    latest: history.revisions[history.revisions.length - 1],
  });

  return {
    async applyCapture(capture) {
      const key = keyOf(capture.source, capture.externalId);
      const current = listings.get(key);
      const plan = planListingCapture({
        existing: current === undefined ? null : latestOf(current),
        capture,
      });
      switch (plan.kind) {
        case "new_listing":
          listings.set(key, { ...plan.listing, revisions: [plan.revision] });
          break;
        case "revision":
          listings.set(key, {
            ...current!,
            canonicalUrl: plan.canonicalUrl,
            lastSeenAt: plan.lastSeenAt,
            revisions: [...current!.revisions, plan.revision],
          });
          break;
        case "seen":
          listings.set(key, {
            ...current!,
            canonicalUrl: plan.canonicalUrl,
            lastSeenAt: plan.lastSeenAt,
          });
          break;
        case "out_of_order":
          listings.set(key, { ...current!, firstSeenAt: plan.firstSeenAt });
          break;
      }
      return plan.kind;
    },
    async readListing(source, externalId) {
      return listings.get(keyOf(source, externalId)) ?? null;
    },
    async listRecent(limit) {
      return [...listings.values()]
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .slice(0, limit)
        .map(latestOf);
    },
    snapshot: () => [...listings.values()],
  };
}
