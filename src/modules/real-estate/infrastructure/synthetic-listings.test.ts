import { describe, expect, it } from "vitest";

import { listingCaptureSchema } from "../domain/listing-capture";
import {
  LAND_IN_PESOS_WITHOUT_AREA,
  PRICE_CUTS_TWICE,
  REPUBLICATION,
  SAME_HOUSE_THREE_AGENCIES,
  SHARED_PIN,
} from "./synthetic-listings";

const parse = (raw: unknown) => listingCaptureSchema.parse(raw);

describe("synthetic real-estate fixtures", () => {
  it("are all valid captures under listing-capture-1.0.0", () => {
    const all = [
      ...SAME_HOUSE_THREE_AGENCIES.captures,
      REPUBLICATION.original,
      REPUBLICATION.relisted,
      ...PRICE_CUTS_TWICE.captures,
      PRICE_CUTS_TWICE.seenAgain,
      ...SHARED_PIN.captures,
      LAND_IN_PESOS_WITHOUT_AREA,
    ];
    for (const raw of all) expect(() => parse(raw)).not.toThrow();
  });

  it("publish the same house through three agencies on three portals", () => {
    const captures = SAME_HOUSE_THREE_AGENCIES.captures.map(parse);
    expect(new Set(captures.map((capture) => capture.source)).size).toBe(3);
    expect(new Set(captures.map((capture) => capture.agency)).size).toBe(3);
    expect(new Set(captures.map((capture) => capture.priceAmount)).size).toBe(
      3,
    );
    // La mejor evidencia entre agencias: comparten la primera foto o casi.
    const firstPhotos = captures.map((capture) => capture.photoDhashes[0]);
    expect(
      firstPhotos.every((hash) => hash?.startsWith("f0e1d2c3b4a5968")),
    ).toBe(true);
  });

  it("relist the same house under another ID after its removal", () => {
    const [original, relisted] = [
      parse(REPUBLICATION.original),
      parse(REPUBLICATION.relisted),
    ];
    expect(original.source).toBe(relisted.source);
    expect(original.externalId).not.toBe(relisted.externalId);
    expect(original.photoDhashes).toEqual(relisted.photoDhashes);
    expect(Date.parse(REPUBLICATION.removedAt)).toBeLessThan(
      Date.parse(relisted.capturedAt),
    );
  });

  it("share one pin across different houses, one of them on request", () => {
    const captures = SHARED_PIN.captures.map(parse);
    expect(
      captures.every(
        (capture) =>
          capture.latitude === SHARED_PIN.latitude &&
          capture.longitude === SHARED_PIN.longitude,
      ),
    ).toBe(true);
    expect(
      new Set(captures.map((capture) => capture.addressDeclared)).size,
    ).toBe(3);
    expect(
      captures.some((capture) => capture.priceStatus === "on_request"),
    ).toBe(true);
  });

  it("keep a peso price in pesos and a missing surface null", () => {
    const land = parse(LAND_IN_PESOS_WITHOUT_AREA);
    expect(land.priceCurrency).toBe("ARS");
    expect([land.coveredAreaM2, land.totalAreaM2, land.landAreaM2]).toEqual([
      null,
      null,
      null,
    ]);
  });
});
