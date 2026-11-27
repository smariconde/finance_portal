import { describe, expect, it } from "vitest";

import {
  PRICE_CUTS_TWICE,
  SAME_HOUSE_THREE_AGENCIES,
} from "../infrastructure/synthetic-listings";
import { listingCaptureSchema, parseListingCapture } from "./listing-capture";

const valid = SAME_HOUSE_THREE_AGENCIES.captures[0];

function issuesOf(input: unknown): readonly string[] {
  const result = parseListingCapture(input);
  if (result.ok) throw new Error("expected a rejection");
  return result.rejection.issues;
}

describe("listing-capture-1.0.0", () => {
  it("accepts a complete detail capture as published", () => {
    const result = parseListingCapture(valid);
    expect(result.ok).toBe(true);
  });

  it("rejects a field outside the contract, naming the key but never its value", () => {
    const issues = issuesOf({ ...valid, phone: "351-5550000" });
    expect(issues.join(" ")).toContain("phone");
    expect(issues.join(" ")).not.toContain("5550000");
  });

  it("rejects a zero price and accepts «consultar precio» as on_request with a null price", () => {
    expect(issuesOf({ ...valid, priceAmount: "0" })).toEqual([
      "priceAmount:not_positive",
    ]);
    expect(issuesOf({ ...valid, priceAmount: 0 })[0]).toMatch(/^priceAmount:/u);
    const onRequest = parseListingCapture({
      ...valid,
      priceStatus: "on_request",
      priceAmount: null,
      priceCurrency: null,
    });
    expect(onRequest.ok && onRequest.capture.priceAmount).toBeNull();
  });

  it("keeps price status, amount and currency together", () => {
    expect(
      issuesOf({ ...valid, priceStatus: "on_request", priceCurrency: null }),
    ).toEqual(["priceAmount:price_with_on_request"]);
    expect(
      issuesOf({ ...valid, priceAmount: null, priceCurrency: null }),
    ).toEqual(["priceAmount:price_missing", "priceCurrency:currency_missing"]);
    expect(issuesOf({ ...valid, expensesAmount: "85000" })).toEqual([
      "expensesCurrency:expenses_amount_and_currency_together",
    ]);
  });

  it("rejects a negative or zero surface and a non-canonical decimal", () => {
    expect(issuesOf({ ...valid, coveredAreaM2: "-180" })).toEqual([
      "coveredAreaM2:not_a_canonical_positive_decimal",
    ]);
    expect(issuesOf({ ...valid, landAreaM2: "0.0" })[0]).toMatch(
      /^landAreaM2:/u,
    );
    for (const written of ["85.50", "85,5", "085", "1e3", " 85"]) {
      expect(issuesOf({ ...valid, totalAreaM2: written })[0]).toMatch(
        /^totalAreaM2:/u,
      );
    }
    expect(parseListingCapture({ ...valid, totalAreaM2: "0.5" }).ok).toBe(true);
  });

  it("rejects an amenity outside the closed set and a repeated one", () => {
    expect(issuesOf({ ...valid, amenities: ["pool", "jacuzzi"] })[0]).toMatch(
      /^amenities\.1:/u,
    );
    expect(issuesOf({ ...valid, amenities: ["pool", "pool"] })).toEqual([
      "amenities:repeated_value",
    ]);
    expect(issuesOf({ ...valid, legalFlags: ["mortgage"] })[0]).toMatch(
      /^legalFlags\.0:/u,
    );
  });

  it("requires a canonical portal URL: its own host, no query, fragment or credentials", () => {
    expect(
      issuesOf({ ...valid, canonicalUrl: "https://www.zonaprop.com.ar/x" }),
    ).toEqual(["canonicalUrl:host_outside_portal"]);
    expect(
      issuesOf({
        ...valid,
        canonicalUrl: "https://evil-remax.com.ar/listings/x",
      }),
    ).toEqual(["canonicalUrl:host_outside_portal"]);
    expect(
      issuesOf({
        ...valid,
        canonicalUrl: "https://www.remax.com.ar/listings/x?utm_source=a",
      }),
    ).toEqual(["canonicalUrl:query_in_canonical_url"]);
    expect(
      issuesOf({ ...valid, canonicalUrl: "https://www.remax.com.ar/x#fotos" }),
    ).toEqual(["canonicalUrl:fragment_in_canonical_url"]);
    expect(
      issuesOf({ ...valid, canonicalUrl: "http://www.remax.com.ar/x" })[0],
    ).toMatch(/^canonicalUrl:/u);
    expect(
      parseListingCapture({
        ...valid,
        canonicalUrl: "https://remax.com.ar/listings/x",
      }).ok,
    ).toBe(true);
  });

  it("keeps coordinates together, canonical and in range", () => {
    expect(issuesOf({ ...valid, longitude: null })).toEqual([
      "longitude:coordinates_together",
    ]);
    expect(issuesOf({ ...valid, latitude: "-91" })).toEqual([
      "latitude:out_of_range",
    ]);
    expect(issuesOf({ ...valid, latitude: "-31.380" })[0]).toMatch(
      /^latitude:/u,
    );
  });

  it("checks hashes, photo counts, dates and published text", () => {
    expect(issuesOf({ ...valid, descriptionSimhash: "XYZ" })[0]).toMatch(
      /^descriptionSimhash:/u,
    );
    expect(
      issuesOf({
        ...valid,
        photoDhashes: Array(6).fill("0123456789abcdef"),
      })[0],
    ).toMatch(/^photoDhashes:/u);
    expect(issuesOf({ ...valid, photoCount: 2 })).toEqual([
      "photoCount:fewer_photos_than_hashes",
    ]);
    expect(issuesOf({ ...valid, publishedAt: "2026-11-02" })).toEqual([
      "publishedAt:published_after_capture",
    ]);
    expect(
      issuesOf({ ...valid, addressDeclared: " Av. Sintética 1234" }),
    ).toEqual(["addressDeclared:untrimmed"]);
    expect(issuesOf({ ...valid, agency: "Uno\nDos" })).toEqual([
      "agency:control_character",
    ]);
    expect(
      issuesOf({ ...valid, capturedAt: "2026-11-01T12:00:00-03:00" })[0],
    ).toMatch(/^capturedAt:/u);
  });

  it("closes counts to plausible integers and null, never zero rooms", () => {
    expect(issuesOf({ ...valid, rooms: 0 })[0]).toMatch(/^rooms:/u);
    expect(issuesOf({ ...valid, bathrooms: 1.5 })[0]).toMatch(/^bathrooms:/u);
    expect(parseListingCapture({ ...valid, bedrooms: 0, floor: -1 }).ok).toBe(
      true,
    );
  });

  it("accepts a search card with only what it shows", () => {
    expect(
      listingCaptureSchema.safeParse(PRICE_CUTS_TWICE.captures[1]).success,
    ).toBe(true);
  });
});
