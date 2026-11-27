import { describe, expect, it } from "vitest";

import {
  PRICE_CUTS_TWICE,
  REPUBLICATION,
} from "../infrastructure/synthetic-listings";
import { listingCaptureSchema, type ListingCapture } from "./listing-capture";
import {
  ListingRevisionError,
  factsOf,
  listingContentHash,
  listingRevisionAt,
  planListingCapture,
  planListingRemoval,
  type ListingRevision,
  type StoredListing,
} from "./listing-revisions";

const parse = (raw: unknown): ListingCapture => listingCaptureSchema.parse(raw);

/** Aplica un plan como lo haría el repositorio y devuelve la cadena. */
function record(captures: readonly unknown[]): {
  listing: StoredListing;
  revisions: ListingRevision[];
  kinds: string[];
} {
  let listing: StoredListing | null = null;
  const revisions: ListingRevision[] = [];
  const kinds: string[] = [];
  for (const raw of captures) {
    const plan = planListingCapture({ existing: listing, capture: parse(raw) });
    kinds.push(plan.kind);
    if (plan.kind === "new_listing") {
      revisions.push(plan.revision);
      listing = { ...plan.listing, latest: plan.revision };
    } else if (plan.kind === "revision") {
      revisions.push(plan.revision);
      listing = {
        ...listing!,
        canonicalUrl: plan.canonicalUrl,
        lastSeenAt: plan.lastSeenAt,
        latest: plan.revision,
      };
    } else if (plan.kind === "seen") {
      listing = { ...listing!, lastSeenAt: plan.lastSeenAt };
    } else {
      listing = { ...listing!, firstSeenAt: plan.firstSeenAt };
    }
  }
  return { listing: listing!, revisions, kinds };
}

describe("listing-revision-1.0.0", () => {
  it("writes a revision only when something changes: two price cuts, then seen again", () => {
    const { listing, revisions, kinds } = record([
      ...PRICE_CUTS_TWICE.captures,
      PRICE_CUTS_TWICE.seenAgain,
    ]);
    expect(kinds).toEqual(["new_listing", "revision", "revision", "seen"]);
    expect(revisions.map((revision) => revision.facts.priceAmount)).toEqual([
      "120000",
      "115000",
      "109000",
    ]);
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2, 3]);
    expect(listing.firstSeenAt).toBe("2026-09-20T13:00:00.000Z");
    expect(listing.lastSeenAt).toBe("2026-11-20T13:00:00.000Z");
    expect(listing.latest.observedAt).toBe("2026-11-05T13:00:00.000Z");
  });

  it("lets a search card after the detail move only the price", () => {
    const { revisions } = record(PRICE_CUTS_TWICE.captures.slice(0, 2));
    const card = revisions[1]!;
    expect(card.pageKind).toBe("search_result");
    expect(card.detailSeen).toBe(true);
    expect(card.facts.coveredAreaM2).toBe("72.5");
    expect(card.facts.amenities).toEqual(["balcony", "elevator", "sum"]);
    expect(card.facts.priceAmount).toBe("115000");
  });

  it("names what changed and stays put on a reordered set", () => {
    const first = planListingCapture({
      existing: null,
      capture: parse(PRICE_CUTS_TWICE.captures[0]),
    });
    if (first.kind !== "new_listing") throw new Error("expected new");
    const listing = { ...first.listing, latest: first.revision };
    const cut = planListingCapture({
      existing: listing,
      capture: parse({
        ...PRICE_CUTS_TWICE.captures[0],
        priceAmount: "118000",
        priceCurrency: "ARS",
        totalAreaM2: "79",
        capturedAt: "2026-09-21T13:00:00.000Z",
      }),
    });
    expect(cut.kind === "revision" && cut.changes).toEqual([
      "price",
      "currency",
      "surface",
    ]);
    const agency = planListingCapture({
      existing: listing,
      capture: parse({
        ...PRICE_CUTS_TWICE.captures[0],
        agency: "Otra Sintética",
        capturedAt: "2026-09-21T13:00:00.000Z",
      }),
    });
    expect(agency.kind === "revision" && agency.changes).toEqual(["content"]);
    const reordered = parse({
      ...PRICE_CUTS_TWICE.captures[0],
      amenities: ["sum", "elevator", "balcony"],
    });
    expect(listingContentHash(factsOf(reordered))).toBe(
      first.revision.contentHash,
    );
  });

  it("never rewrites the chain with a late capture from the local queue", () => {
    const { listing } = record(PRICE_CUTS_TWICE.captures);
    const late = planListingCapture({
      existing: listing,
      capture: parse({
        ...PRICE_CUTS_TWICE.captures[0],
        priceAmount: "125000",
        capturedAt: "2026-09-16T13:00:00.000Z",
      }),
    });
    expect(late).toEqual({
      kind: "out_of_order",
      firstSeenAt: "2026-09-16T13:00:00.000Z",
    });
    const sameInstant = planListingCapture({
      existing: listing,
      capture: parse(PRICE_CUTS_TWICE.captures[2]),
    });
    expect(sameInstant.kind).toBe("out_of_order");
  });

  it("removes only with evidence, keeps the facts, and reopens when seen again", () => {
    const { listing } = record([REPUBLICATION.original]);
    const removal = planListingRemoval({
      existing: listing,
      evidence: "portal_finished",
      observedAt: REPUBLICATION.removedAt,
      pageKind: "listing_detail",
      parseBasis: "json_ld",
    });
    expect(removal).toMatchObject({
      revision: 2,
      status: "removed",
      removalEvidence: "portal_finished",
      facts: listing.latest.facts,
    });
    const removed = { ...listing, latest: removal };
    expect(() =>
      planListingRemoval({
        existing: removed,
        evidence: "http_404",
        observedAt: "2026-10-21T14:00:00.000Z",
        pageKind: "listing_detail",
        parseBasis: "json_ld",
      }),
    ).toThrow(new ListingRevisionError("already_removed"));
    const back = planListingCapture({
      existing: removed,
      capture: parse({
        ...REPUBLICATION.original,
        capturedAt: "2026-10-25T14:00:00.000Z",
      }),
    });
    expect(back.kind === "revision" && back.changes).toEqual(["status"]);
  });

  it("treats a republication with another ID as another listing; joining them is deduplication's job", () => {
    const { listing } = record([REPUBLICATION.original]);
    expect(() =>
      planListingCapture({
        existing: listing,
        capture: parse(REPUBLICATION.relisted),
      }),
    ).toThrow(new ListingRevisionError("capture_for_another_listing"));
    expect(
      planListingCapture({
        existing: null,
        capture: parse(REPUBLICATION.relisted),
      }).kind,
    ).toBe("new_listing");
  });

  it("reads the revision in force at an instant, never a later one", () => {
    const { revisions } = record(PRICE_CUTS_TWICE.captures);
    expect(listingRevisionAt(revisions, "2026-09-19T00:00:00.000Z")).toBeNull();
    expect(
      listingRevisionAt(revisions, "2026-10-12T12:59:59.999Z")?.facts
        .priceAmount,
    ).toBe("120000");
    expect(
      listingRevisionAt(revisions, "2026-10-12T13:00:00.000Z")?.facts
        .priceAmount,
    ).toBe("115000");
  });
});
