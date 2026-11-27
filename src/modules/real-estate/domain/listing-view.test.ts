import { describe, expect, it } from "vitest";

import { createInMemoryListingStore } from "../infrastructure/in-memory-listing-store";
import { PRICE_CUTS_TWICE } from "../infrastructure/synthetic-listings";
import { parseListingCapture } from "./listing-capture";
import type { ListingRevision } from "./listing-revisions";
import {
  listingSlug,
  parseListingSlug,
  priceCuts,
  priceHistory,
} from "./listing-view";

async function revisionsOf(captures: readonly unknown[]) {
  const store = createInMemoryListingStore();
  for (const raw of captures) {
    const parsed = parseListingCapture(raw);
    if (!parsed.ok) throw new Error("fixture capture must parse");
    await store.applyCapture(parsed.capture, parsed.capture.capturedAt);
  }
  return store.snapshot()[0].revisions;
}

describe("listing-view-1.0.0", () => {
  it("lee el historial de precio de la más reciente a la primera", async () => {
    const revisions = await revisionsOf(PRICE_CUTS_TWICE.captures);
    const history = priceHistory(revisions);
    expect(history.map((entry) => entry.revision)).toEqual(
      [...revisions].reverse().map((revision) => revision.revision),
    );
    expect(history.at(-1)).toMatchObject({
      changeGap: "first",
      change: null,
      changes: [],
    });
    const cuts = history.filter((entry) => entry.change?.startsWith("-"));
    expect(cuts.length).toBe(priceCuts(history));
    expect(priceCuts(history)).toBe(2);
    for (const cut of cuts) expect(cut.changes).toContain("price");
  });

  it("calcula la variación con decimales exactos", () => {
    const base = {
      observedAt: "2026-11-01T00:00:00.000Z",
      pageKind: "listing_detail",
      parseBasis: "embedded_state",
      status: "active",
      removalEvidence: null,
      detailSeen: true,
      contentHash: "a".repeat(64),
    } as const;
    const facts = (
      priceAmount: string | null,
      priceCurrency: "USD" | "ARS" | null,
    ) =>
      ({
        priceAmount,
        priceCurrency,
        priceStatus: priceAmount === null ? "on_request" : "published",
      }) as unknown as ListingRevision["facts"];
    const history = priceHistory([
      { ...base, revision: 1, facts: facts("120000", "USD") },
      {
        ...base,
        revision: 2,
        facts: facts("114000", "USD"),
        contentHash: "b".repeat(64),
      },
      {
        ...base,
        revision: 3,
        facts: facts(null, null),
        contentHash: "c".repeat(64),
      },
      {
        ...base,
        revision: 4,
        facts: facts("110000000", "ARS"),
        contentHash: "d".repeat(64),
      },
    ]);
    expect(history.map((entry) => [entry.change, entry.changeGap])).toEqual([
      [null, "currency_changed"],
      [null, "on_request"],
      ["-0.05", null],
      [null, "first"],
    ]);
  });

  it("arma y lee el segmento de la ficha", () => {
    const slug = listingSlug(
      "remax-ar",
      "11111111-2222-4333-8444-555555555555",
    );
    expect(slug).toBe("remax-ar.11111111-2222-4333-8444-555555555555");
    expect(parseListingSlug(slug)).toEqual({
      source: "remax-ar",
      externalId: "11111111-2222-4333-8444-555555555555",
    });
    expect(parseListingSlug("zonaprop.SYN.1")).toEqual({
      source: "zonaprop",
      externalId: "SYN.1",
    });
    for (const bad of [
      "remax-ar",
      ".x",
      "otro.x",
      "remax-ar./x",
      "remax-ar.-x",
    ]) {
      expect(parseListingSlug(bad), bad).toBeNull();
    }
  });
});
