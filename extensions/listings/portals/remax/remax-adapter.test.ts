import { describe, expect, it } from "vitest";

import type { PortalDocument } from "../types";
import { mapRemaxListing, remaxAdapter } from "./remax-adapter";

/**
 * Datos sintéticos con la **forma** medida en Remax el 2026-11-27: claves,
 * tipos y envoltorio de `ng-state`. Los valores son inventados; la captura
 * real reducida es el corpus.
 */
const CAPTURED_AT = "2026-11-27T20:30:00.000Z";

function detailListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    title: "VENTA CASA 3 DORM. CON PATIO",
    slug: "venta-casa-3-dorm-con-patio",
    description:
      "Casa en barrio Alta Córdoba, a refaccionar, con escritura. Patio y parrilla.",
    location: { type: "Point", coordinates: [-64.1846103, -31.3920812] },
    totalRooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    toilets: 0,
    floors: 2,
    parkingSpaces: 1,
    yearBuilt: 1978,
    price: 98500,
    priceExposure: true,
    currency: { id: 1, value: "USD" },
    expensesPrice: null,
    expensesCurrency: { id: 2, value: "ARS" },
    aptCredit: true,
    internalId: "400000001-1",
    displayAddress: "Calle Falsa 1200",
    dimensionLand: 300,
    dimensionTotalBuilt: 160.5,
    dimensionCovered: 140.25,
    dimensionUncovered: 20.25,
    conditions: [{ id: 4, value: "a_refaccionar" }],
    features: [
      { category: { value: "environments" }, value: "Jardín" },
      { category: "environments", value: "Quincho", lang: "quincho" },
      { category: "environments", value: "Pileta", lang: "pileta" },
      { category: { value: "service" }, value: "Gas" },
    ],
    geo: { neighborhood: null },
    photos: Array.from({ length: 12 }, (_, index) => ({
      value: `listings/x/${index}.jpg`,
    })),
    operation: { id: 1, value: "sale" },
    type: { id: 1, value: "casa" },
    listingStatus: { id: 1, value: "active" },
    associate: {
      name: "Persona Que No Viaja",
      phones: ["+54 351 000-0000"],
      office: { name: "REMAX Ejemplo" },
    },
    ...overrides,
  };
}

function cardListing(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 700000 + index,
    entityId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    entrepreneurship: false,
    slug: `aviso-sintetico-${index}`,
    title: "DEPARTAMENTO 1 DORM",
    operation: { id: 1, value: "sale" },
    type: { id: 2, value: "departamento_estandar" },
    listingStatus: { id: 1, value: "active" },
    price: 50000 + index,
    priceExposure: true,
    currency: { id: 1, value: "USD" },
    expensesPrice: 45000,
    expensesCurrency: { id: 2, value: "ARS" },
    totalRooms: 2,
    bedrooms: 1,
    bathrooms: 1,
    dimensionLand: 0,
    dimensionTotalBuilt: 49.76,
    dimensionCovered: 49.76,
    displayAddress: "Rincón 1900",
    geoLabel: "Cordoba, Capital, Córdoba",
    location: { type: "Point", coordinates: [-64.1599368, -31.4053348] },
    associate: { officeName: "REMAX Ejemplo", phones: ["+54 351 000-0000"] },
    photos: Array.from({ length: 5 }, () => ({})),
    ...overrides,
  };
}

function ngState(responses: readonly { u: string; data: unknown }[]) {
  const state: Record<string, unknown> = {
    "transfer-translate-es-AR": {},
    __nghData__: [],
  };
  responses.forEach((response, index) => {
    state[String(82142215 + index)] = {
      u: response.u,
      b: { data: response.data, code: 200, message: "OK", errors: [] },
      h: {},
      s: 200,
      st: "OK",
      rt: "json",
    };
  });
  return JSON.stringify(state);
}

function document(url: string, state: string | null): PortalDocument {
  return {
    url,
    capturedAt: CAPTURED_AT,
    embeddedStates: { "script#ng-state": state },
    jsonLd: [],
  };
}

const API = "https://api-ar.redremax.com/remaxweb-ar/api";

describe("remax-ng-state-1.0.0", () => {
  it("lee una ficha del estado embebido", () => {
    const reading = remaxAdapter.read(
      document(
        "https://www.remax.com.ar/listings/venta-casa-3-dorm-con-patio",
        ngState([
          { u: `${API}/associates/auctioneerOffice/abc`, data: [] },
          {
            u: `${API}/listings/findBySlug/venta-casa-3-dorm-con-patio`,
            data: detailListing(),
          },
        ]),
      ),
    );
    expect(reading.kind).toBe("captures");
    if (reading.kind !== "captures") return;
    expect(reading.captures).toHaveLength(1);
    expect(reading.captures[0]).toMatchObject({
      source: "remax-ar",
      externalId: "11111111-2222-4333-8444-555555555555",
      canonicalUrl:
        "https://www.remax.com.ar/listings/venta-casa-3-dorm-con-patio",
      pageKind: "listing_detail",
      parseBasis: "embedded_state",
      operation: "sale",
      propertyType: "house",
      priceAmount: "98500",
      priceStatus: "published",
      priceCurrency: "USD",
      expensesAmount: null,
      expensesCurrency: null,
      coveredAreaM2: "140.25",
      totalAreaM2: "160.5",
      landAreaM2: "300",
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      parkingSpaces: 1,
      ageYears: 48,
      floor: null,
      amenities: ["garden", "grill", "pool"],
      condition: "to_renovate",
      legalFlags: ["credit_eligible", "deed"],
      addressDeclared: "Calle Falsa 1200",
      neighborhood: null,
      latitude: "-31.392081",
      longitude: "-64.18461",
      agency: "REMAX Ejemplo",
      publishedAt: null,
      photoDhashes: [],
      photoCount: 12,
    });
    expect(reading.captures[0].descriptionSimhash).toMatch(/^[0-9a-f]{16}$/u);
  });

  it("nunca deja salir texto ni contacto", () => {
    const mapped = mapRemaxListing(
      detailListing(),
      "listing_detail",
      CAPTURED_AT,
    );
    expect(mapped.ok).toBe(true);
    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain("Persona Que No Viaja");
    expect(serialized).not.toContain("351");
    expect(serialized).not.toContain("Alta Córdoba");
    expect(serialized).not.toContain("listings/x/");
  });

  it("lee las 24 tarjetas de un listado con su uuid, no el id numérico", () => {
    const cards = Array.from({ length: 24 }, (_, index) => cardListing(index));
    const reading = remaxAdapter.read(
      document(
        "https://www.remax.com.ar/listings/buy?page=0&pageSize=24&sort=-createdAt",
        ngState([
          { u: `${API}/currencies/findAll`, data: [] },
          {
            u: `${API}/listings/findAllWithEntrepreneurships?page=0&pageSize=24`,
            data: {
              data: cards,
              page: 0,
              pageSize: 24,
              totalPages: 63,
              totalItems: 1509,
            },
          },
        ]),
      ),
    );
    expect(reading.kind).toBe("captures");
    if (reading.kind !== "captures") return;
    expect(reading.pageKind).toBe("search_result");
    expect(reading.captures).toHaveLength(24);
    expect(reading.captures[3]).toMatchObject({
      externalId: "00000000-0000-4000-8000-000000000003",
      propertyType: "apartment",
      priceAmount: "50003",
      expensesAmount: "45000",
      expensesCurrency: "ARS",
      landAreaM2: null,
      parkingSpaces: null,
      descriptionSimhash: null,
      photoCount: 5,
    });
  });

  it("nombra lo que deja afuera de un listado", () => {
    const cards = [
      cardListing(1),
      cardListing(2, { entrepreneurship: true }),
      cardListing(3, { type: { value: "galpon" } }),
      cardListing(4, { listingStatus: { value: "sold" } }),
      cardListing(5, { price: 0 }),
      cardListing(6, { price: "USD 10" }),
      cardListing(1),
    ];
    const reading = remaxAdapter.read(
      document(
        "https://www.remax.com.ar/listings/buy",
        ngState([
          {
            u: `${API}/listings/findAllWithEntrepreneurships`,
            data: { data: cards },
          },
        ]),
      ),
    );
    expect(reading).toMatchObject({
      kind: "captures",
      skipped: {
        entrepreneurship: 1,
        property_type_unmapped: 1,
        status_not_published: 1,
        price_missing: 1,
        "field_invalid:price": 1,
        repeated_on_page: 1,
      },
    });
    if (reading.kind === "captures") expect(reading.captures).toHaveLength(1);
  });

  it("las variantes con prefijo toman el tipo del prefijo; un galpón no", () => {
    const typeOf = (value: string) => {
      const mapped = mapRemaxListing(
        detailListing({ type: { value } }),
        "listing_detail",
        CAPTURED_AT,
      );
      return mapped.ok ? mapped.capture.propertyType : mapped.reason;
    };
    expect(typeOf("departamento_penthouse")).toBe("apartment");
    expect(typeOf("casa_quinta")).toBe("house");
    expect(typeOf("galpon")).toBe("property_type_unmapped");
  });

  it("«consultar precio» es un estado, no un cero", () => {
    const mapped = mapRemaxListing(
      detailListing({ priceExposure: false, price: 120000 }),
      "listing_detail",
      CAPTURED_AT,
    );
    expect(mapped).toMatchObject({
      ok: true,
      capture: {
        priceStatus: "on_request",
        priceAmount: null,
        priceCurrency: null,
      },
    });
  });

  it("un terreno no tiene ambientes ni estado, y el 0 final no es una altura", () => {
    const mapped = mapRemaxListing(
      detailListing({
        type: { value: "terrenos_y_lotes" },
        totalRooms: 0,
        bedrooms: 0,
        bathrooms: 0,
        dimensionCovered: 0,
        dimensionTotalBuilt: 0,
        yearBuilt: null,
        displayAddress: "Lote 29 Manzana 129 0",
        conditions: [{ value: "a_estrenar" }],
      }),
      "listing_detail",
      CAPTURED_AT,
    );
    expect(mapped).toMatchObject({
      ok: true,
      capture: {
        propertyType: "land",
        rooms: null,
        bedrooms: null,
        bathrooms: null,
        coveredAreaM2: null,
        totalAreaM2: null,
        ageYears: null,
        condition: "unknown",
        addressDeclared: "Lote 29 Manzana 129",
      },
    });
  });

  it("expensas en cero o sin moneda no son expensas", () => {
    for (const overrides of [
      { expensesPrice: 0 },
      { expensesPrice: 1000, expensesCurrency: null },
    ]) {
      const mapped = mapRemaxListing(
        detailListing(overrides),
        "listing_detail",
        CAPTURED_AT,
      );
      expect(mapped).toMatchObject({
        ok: true,
        capture: { expensesAmount: null, expensesCurrency: null },
      });
    }
  });

  it("un pin en [0, 0] no es una ubicación", () => {
    const mapped = mapRemaxListing(
      detailListing({ location: { coordinates: [0, 0] } }),
      "listing_detail",
      CAPTURED_AT,
    );
    expect(mapped).toMatchObject({
      ok: true,
      capture: { latitude: null, longitude: null },
    });
  });

  it("rechaza por nombre cuando no hay estado o no hay respuesta", () => {
    const url = "https://www.remax.com.ar/listings/venta-casa-3-dorm-con-patio";
    expect(remaxAdapter.read(document(url, null))).toEqual({
      kind: "rejected",
      reason: "embedded_state_missing",
    });
    expect(remaxAdapter.read(document(url, "{no es json"))).toEqual({
      kind: "rejected",
      reason: "embedded_state_missing",
    });
    expect(
      remaxAdapter.read(
        document(
          url,
          ngState([
            {
              u: `${API}/listings/findBySlug/otro-aviso`,
              data: detailListing(),
            },
          ]),
        ),
      ),
    ).toEqual({ kind: "rejected", reason: "detail_response_missing" });
    expect(
      remaxAdapter.read(
        document(
          url,
          ngState([
            {
              u: `${API}/listings/findBySlug/venta-casa-3-dorm-con-patio`,
              data: detailListing({ operation: { value: "temporary" } }),
            },
          ]),
        ),
      ),
    ).toEqual({ kind: "rejected", reason: "operation_unmapped" });
  });

  it("sólo reconoce fichas y listados del portal", () => {
    const kind = (url: string) => remaxAdapter.pageKindOf(new URL(url));
    expect(kind("https://www.remax.com.ar/listings/buy")).toBe("search_result");
    expect(kind("https://www.remax.com.ar/listings/rent?page=2")).toBe(
      "search_result",
    );
    expect(kind("https://www.remax.com.ar/listings/casa-en-venta-1")).toBe(
      "listing_detail",
    );
    expect(kind("https://www.remax.com.ar/")).toBeNull();
    expect(kind("https://www.remax.com.ar/listings/a/b")).toBeNull();
    expect(kind("https://otro.com.ar/listings/buy")).toBeNull();
    expect(
      remaxAdapter.read(document("https://www.remax.com.ar/agentes", "{}")),
    ).toEqual({ kind: "not_a_listing_page" });
  });
});
