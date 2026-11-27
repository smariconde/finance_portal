import { describe, expect, it } from "vitest";

import type { ExportedPage } from "../capture/messages";
import { remaxAdapter } from "../portals/remax/remax-adapter";
import { CorpusReductionError, corpusFileText, reducePage } from "./reducer";

const PERSONAL = [
  "Persona Particular",
  "persona@example.com",
  "+54 9 351 555-0000",
  "https://d1acdg20u0pmxj.cloudfront.net/listings/a/b.jpg",
  "utm_source",
  "cookie=abc",
];

function exported(
  state: unknown,
  url = "https://www.remax.com.ar/listings/casa-sintetica?utm_source=x",
): ExportedPage {
  return {
    exportVersion: "listing-page-export-1.0.0",
    source: "remax-ar",
    adapterVersion: "remax-ng-state-1.0.0",
    document: {
      url,
      capturedAt: "2026-11-27T20:00:00.000Z",
      embeddedStates: { "script#ng-state": JSON.stringify(state) },
      jsonLd: ['{"@type":"BreadcrumbList","name":"Persona Particular"}'],
    },
  };
}

const LISTING = {
  id: "11111111-2222-4333-8444-555555555555",
  slug: "casa-sintetica",
  internalId: "400000001-1",
  title: "CASA SINTÉTICA",
  description: "Llamar a Persona Particular al +54 9 351 555-0000",
  operation: { id: 1, value: "sale" },
  type: { id: 1, value: "casa" },
  listingStatus: { id: 1, value: "active" },
  price: 100000,
  priceExposure: true,
  currency: { id: 1, value: "USD" },
  dimensionCovered: 120,
  totalRooms: 4,
  bedrooms: 2,
  bathrooms: 1,
  location: { type: "Point", coordinates: [-64.18, -31.41] },
  features: [
    {
      category: { value: "environments" },
      value: "Jardín",
      note: "Persona Particular",
    },
  ],
  photos: [
    { value: "https://d1acdg20u0pmxj.cloudfront.net/listings/a/b.jpg" },
    { value: "x" },
  ],
  video: "https://youtube.example/persona",
  associate: {
    name: "Persona Particular",
    emails: ["persona@example.com"],
    phones: ["+54 9 351 555-0000"],
    office: { name: "REMAX Ejemplo", phone: "+54 9 351 555-0000" },
  },
  listBroker: [{ name: "Persona Particular" }],
  newSecretField: "persona@example.com",
};

const STATE = {
  "transfer-translate-es-AR": { hello: "Persona Particular" },
  "123": {
    u: "https://api-ar.redremax.com/remaxweb-ar/api/listings/findBySlug/casa-sintetica?cookie=abc",
    s: 200,
    h: { "set-cookie": "cookie=abc" },
    b: { data: LISTING },
  },
  "456": {
    u: "https://api-ar.redremax.com/remaxweb-ar/api/associates/auctioneerOffice/x",
    s: 200,
    b: { data: [{ name: "Persona Particular" }] },
  },
};

describe("listing-corpus-reducer-1.0.0", () => {
  it("no deja pasar contacto, descripción, fotos ni campos nuevos", () => {
    const text = corpusFileText(reducePage(exported(STATE)));
    for (const value of PERSONAL) expect(text).not.toContain(value);
    expect(text).not.toContain("newSecretField");
    expect(text).not.toContain("description");
    expect(text).toContain("REMAX Ejemplo");
  });

  it("lo reducido se sigue leyendo igual en todo lo que el adapter usa", () => {
    const original = remaxAdapter.read(exported(STATE).document);
    const reduced = remaxAdapter.read(reducePage(exported(STATE)).document);
    expect(reduced.kind).toBe("captures");
    expect(original.kind).toBe("captures");
    if (reduced.kind !== "captures" || original.kind !== "captures") return;
    // Sólo cambia lo que sale de la descripción, que el corpus no guarda.
    const { descriptionSimhash: _a, ...rest } = original.captures[0];
    const { descriptionSimhash, ...reducedRest } = reduced.captures[0];
    void _a;
    expect(reducedRest).toEqual(rest);
    expect(descriptionSimhash).not.toBeUndefined();
    expect(reduced.captures[0].photoCount).toBe(2);
  });

  it("rechaza por nombre lo que no es una página exportada de un portal conocido", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof CorpusReductionError ? error.code : "other";
      }
      return "none";
    };
    expect(
      code(() =>
        reducePage({ ...exported(STATE), exportVersion: "x" as never }),
      ),
    ).toBe("export_version_unknown");
    expect(
      code(() => reducePage({ ...exported(STATE), source: "zonaprop" })),
    ).toBe("portal_without_reduction");
    expect(
      code(() =>
        reducePage(exported({ a: { u: "/otra/api", b: { data: 1 } } })),
      ),
    ).toBe("no_listing_response");
  });
});
