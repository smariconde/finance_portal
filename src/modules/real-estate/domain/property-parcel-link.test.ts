import { describe, expect, it } from "vitest";

import {
  PropertyParcelLinkError,
  planPropertyParcelLink,
  propertyParcelLinkAt,
  type PropertyParcelLink,
} from "./property-parcel-link";

const propertyId = "00000000-0000-4000-8000-0000000000b1";
const parcelA = "00000000-0000-4000-8000-0000000000a2";
const parcelB = "00000000-0000-4000-8000-0000000000a3";

function linked(
  plan: ReturnType<typeof planPropertyParcelLink>,
): PropertyParcelLink {
  if (plan.kind !== "link") throw new Error(`expected link, got ${plan.kind}`);
  return plan.insert;
}

describe("property-parcel-link-1.0.0", () => {
  it("affirms a link only with a location precise enough for a parcel", () => {
    for (const precision of [
      "portal_pin_shared",
      "neighborhood_only",
    ] as const) {
      expect(
        planPropertyParcelLink({
          propertyId,
          current: null,
          parcelId: parcelA,
          evidence: { kind: "location", precision },
          observedAt: "2026-11-01T00:00:00.000Z",
        }),
      ).toEqual({ kind: "refused", code: "location_imprecise" });
    }
    const link = linked(
      planPropertyParcelLink({
        propertyId,
        current: null,
        parcelId: parcelA,
        evidence: { kind: "location", precision: "address_geocoded" },
        observedAt: "2026-11-01T00:00:00.000Z",
      }),
    );
    expect(link).toMatchObject({
      revision: 1,
      basis: "address_geocoded",
      confidence: "probable",
    });
  });

  it("never lets weaker evidence replace a stronger link, and lets the owner correct any", () => {
    const geocoded = linked(
      planPropertyParcelLink({
        propertyId,
        current: null,
        parcelId: parcelA,
        evidence: { kind: "location", precision: "address_geocoded" },
        observedAt: "2026-11-01T00:00:00.000Z",
      }),
    );
    expect(
      planPropertyParcelLink({
        propertyId,
        current: geocoded,
        parcelId: parcelB,
        evidence: { kind: "location", precision: "portal_pin" },
        observedAt: "2026-11-02T00:00:00.000Z",
      }),
    ).toEqual({ kind: "refused", code: "weaker_than_current_link" });
    expect(
      planPropertyParcelLink({
        propertyId,
        current: geocoded,
        parcelId: parcelA,
        evidence: { kind: "location", precision: "portal_pin" },
        observedAt: "2026-11-02T00:00:00.000Z",
      }),
    ).toEqual({ kind: "unchanged" });

    const corrected = planPropertyParcelLink({
      propertyId,
      current: geocoded,
      parcelId: parcelB,
      evidence: { kind: "owner_declared" },
      observedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(corrected).toMatchObject({
      kind: "link",
      supersede: 1,
      insert: { revision: 2, parcelId: parcelB, confidence: "confirmed" },
    });

    const history = [
      { ...geocoded, supersededAt: "2026-11-03T00:00:00.000Z" },
      linked(corrected),
    ];
    expect(
      propertyParcelLinkAt(history, "2026-11-02T23:59:59.000Z")?.parcelId,
    ).toBe(parcelA);
    expect(
      propertyParcelLinkAt(history, "2026-11-03T00:00:00.000Z")?.parcelId,
    ).toBe(parcelB);
    expect(
      propertyParcelLinkAt(history, "2026-10-31T00:00:00.000Z"),
    ).toBeNull();
  });

  it("refuses evidence that does not come after the link it would replace", () => {
    const geocoded = linked(
      planPropertyParcelLink({
        propertyId,
        current: null,
        parcelId: parcelA,
        evidence: { kind: "location", precision: "address_geocoded" },
        observedAt: "2026-11-01T00:00:00.000Z",
      }),
    );
    expect(() =>
      planPropertyParcelLink({
        propertyId,
        current: geocoded,
        parcelId: parcelB,
        evidence: { kind: "owner_declared" },
        observedAt: "2026-11-01T00:00:00.000Z",
      }),
    ).toThrow(new PropertyParcelLinkError("evidence_not_after_link"));
  });
});
