import { describe, expect, it } from "vitest";

import {
  syntheticBarriosKml,
  syntheticZoningLayer,
} from "../infrastructure/synthetic-location";
import { buildableEnvelope, floorsFromHeight } from "./buildable-envelope";
import { parseBarriosKml } from "./cordoba-barrios";
import type { GeorefResult } from "./georef-addresses";
import { parseZoningLayer, withBox, type ParcelAtPoint } from "./idecor-wfs";
import {
  locationInputHash,
  matchParcel,
  pendingLookups,
  pointKey,
  resolveListingLocation,
  type LocationListing,
} from "./listing-location";
import { fixLocation, sharedPins } from "./location-precision";
import { envelopeOf, formatNomenclature } from "./location-view";
import {
  floorsFromText,
  resolveZoning,
  zoningParametersOf,
  type ZoningQuery,
} from "./zoning-resolution";

const zoningFeatures = parseZoningLayer(syntheticZoningLayer()).map(withBox);
const zoning = {
  releaseId: "00000000-0000-4000-8000-000000000001",
  observedAt: "2026-11-28T03:21:56.000Z",
  features: zoningFeatures,
};
const barrios = {
  releaseId: "00000000-0000-4000-8000-000000000002",
  observedAt: "2026-11-28T03:22:00.000Z",
  features: parseBarriosKml(syntheticBarriosKml()).map(withBox),
};

const listing = (
  overrides: Partial<LocationListing> = {},
): LocationListing => ({
  revision: 1,
  propertyType: "house",
  addressDeclared: "Rondeau 500",
  neighborhood: null,
  latitude: "-31.428",
  longitude: "-64.188",
  landAreaM2: "300",
  ...overrides,
});

const matched = (
  latitude: number,
  longitude: number,
): Extract<GeorefResult, { status: "matched" }> => ({
  status: "matched",
  streetName: "RONDEAU",
  streetId: "1401401037475",
  number: 500,
  latitude,
  longitude,
});

const parcel = (area: string | null): ParcelAtPoint => ({
  nomenclature: "1101010409014065",
  landAreaM2: area,
  state: "EDIFICADO NoPH",
  parcelType: "URBANO",
});

describe("location-precision-1.0.0", () => {
  it("lets the rounded block lose to the portal's own pin", () => {
    const fix = fixLocation({
      listing: listing(),
      pinShared: false,
      geocode: matched(-31.4282, -64.1885),
    });
    expect(fix.precision).toBe("portal_pin");
    expect(fix.point).toEqual({ latitude: -31.428, longitude: -64.188 });
    expect(fix.pinFarFromAddress).toBe(false);
  });

  it("takes an exact number over the pin and flags them 150 m apart", () => {
    const fix = fixLocation({
      listing: listing({ addressDeclared: "Rondeau 517" }),
      pinShared: false,
      geocode: { ...matched(-31.43, -64.188), number: 517 },
    });
    expect(fix.precision).toBe("address_geocoded");
    expect(fix.pinAddressDistanceM).toBe(222);
    expect(fix.pinFarFromAddress).toBe(true);
  });

  it("falls to the block, then the shared pin, then the neighborhood", () => {
    expect(
      fixLocation({
        listing: listing(),
        pinShared: true,
        geocode: matched(-31.4282, -64.1885),
      }).precision,
    ).toBe("address_block");
    expect(
      fixLocation({ listing: listing(), pinShared: true, geocode: null })
        .precision,
    ).toBe("portal_pin_shared");
    expect(
      fixLocation({
        listing: listing({
          latitude: null,
          longitude: null,
          addressDeclared: null,
          neighborhood: "Alberdi",
        }),
        pinShared: false,
        geocode: null,
      }).precision,
    ).toBe("neighborhood_only");
  });

  it("shares a pin only across different addresses", () => {
    const tower = listing({ addressDeclared: "San Lorenzo 400" });
    expect(sharedPins([tower, tower]).size).toBe(0);
    expect(
      sharedPins([tower, listing({ addressDeclared: "Manzana 61 Lote 5" })])
        .size,
    ).toBe(1);
  });
});

describe("parcel-match-1.0.0", () => {
  it("matches within 10 % and names everything else", () => {
    const at = (area: string | null, type: "house" | "apartment" = "house") =>
      matchParcel({
        propertyType: type,
        landAreaM2: "300",
        parcels: [parcel(area)],
      }).status;
    expect(at("329")).toBe("matched");
    expect(at("331")).toBe("area_mismatch");
    expect(at("11588")).toBe("area_mismatch");
    expect(at(null)).toBe("area_unverified");
    expect(at("6166", "apartment")).toBe("building_parcel");
    expect(
      matchParcel({ propertyType: "house", landAreaM2: "300", parcels: [] })
        .status,
    ).toBe("no_parcel_at_point");
    expect(
      matchParcel({
        propertyType: "house",
        landAreaM2: "300",
        parcels: [
          parcel("300"),
          { ...parcel("300"), nomenclature: "1101010409014066" },
        ],
      }).status,
    ).toBe("several_parcels");
  });
});

describe("zoning-resolution-1.0.0", () => {
  it("reads floors as published and FOS as a fraction", () => {
    expect(floorsFromText("Planta Baja + 7 pisos")).toBe(8);
    expect(
      floorsFromText("PB + 4 pisos (Ver Grafico 21 - Perfil XXVIII)"),
    ).toBe(5);
    expect(floorsFromText("Planta Baja + 2 plantas")).toBe(3);
    expect(floorsFromText(null)).toBeNull();
    expect(zoningParametersOf(zoningFeatures[0].properties)).toEqual({
      parameters: { fos: "0.7", fot: "1", heightMaxM: "10.5", floorsMax: 3 },
      missing: [],
    });
  });

  it("takes no parameters from an urban agreement and names missing ones", () => {
    expect(zoningParametersOf(zoningFeatures[2].properties).missing).toEqual([
      "special_agreement",
    ]);
    expect(zoningParametersOf(zoningFeatures[1].properties)).toEqual({
      parameters: {
        fos: "0.8",
        fot: null,
        heightMaxM: "38.5",
        floorsMax: 13,
      },
      missing: ["fot_not_published"],
    });
    expect(
      zoningParametersOf({ ...zoningFeatures[0].properties, fos: 0, fot: 0 })
        .missing,
    ).toEqual(["fos_not_published", "fot_not_published"]);
  });

  const at = (
    basis: Parameters<typeof resolveZoning>[0]["basis"],
    longitude: number,
  ) =>
    resolveZoning({
      basis,
      point: { latitude: -31.425, longitude },
      nomenclature: null,
      query: null,
      layer: zoning,
    });

  it("is the official map for a pin inside one zone", () => {
    expect(at("portal_pin", -64.185)).toMatchObject({
      confidence: "official_map",
      pattern: "8256-G1",
      evidence: "IDECOR CBA_Ordenanza_8256.1",
    });
  });

  it("infers from the surroundings only when one zone is near", () => {
    expect(at("address_block", -64.185)).toMatchObject({
      confidence: "corridor_inferred",
      pattern: "8256-G1",
    });
    expect(at("address_block", -64.18)).toEqual({
      confidence: "unknown",
      reason: "several_zones",
      candidates: ["8057-PERFIL X", "8256-G1"],
    });
    expect(at("portal_pin", -64.1)).toMatchObject({ reason: "outside_layer" });
    expect(at("portal_pin_shared", -64.185)).toMatchObject({
      reason: "shared_pin",
    });
  });

  it("prefers the owner's query for that parcel and only that one", () => {
    const query: ZoningQuery = {
      nomenclature: "1101010409014065",
      pattern: "8256-G2",
      ordinance: "Ord. 8256/86",
      fos: "0.6",
      fot: "1.5",
      heightMaxM: "12",
      floorsMax: 4,
      consultedOn: "2026-12-01",
      reference: "Expediente sintético",
      declaredAt: "2026-12-02T12:00:00.000Z",
    };
    const resolve = (nomenclature: string | null) =>
      resolveZoning({
        basis: "portal_pin",
        point: { latitude: -31.425, longitude: -64.185 },
        nomenclature,
        query,
        layer: zoning,
      }).confidence;
    expect(resolve("1101010409014065")).toBe("official_query");
    expect(resolve("1101010409014066")).toBe("official_map");
  });
});

describe("buildable-envelope-1.0.0", () => {
  it("binds by FOT in a low-rise zone and moves it ±0,3", () => {
    expect(
      buildableEnvelope({
        landAreaM2: "300",
        areaBasis: "parcel",
        parameters: { fos: "0.7", fot: "1", heightMaxM: "10.5", floorsMax: 3 },
      }),
    ).toEqual({
      status: "computed",
      areaBasis: "parcel",
      landAreaM2: "300",
      footprintMaxM2: "210.00",
      fot: "1",
      fotMaxM2: "300.00",
      floors: 3,
      floorsBasis: "published",
      heightBoundM2: "630.00",
      buildableM2: "300.00",
      binding: "fot",
      sensitivity: [
        { fot: "0.7", buildableM2: "210.00" },
        { fot: "1", buildableM2: "300.00" },
        { fot: "1.3", buildableM2: "390.00" },
      ],
    });
  });

  it("binds by height where the center publishes no FOT", () => {
    expect(
      buildableEnvelope({
        landAreaM2: "200",
        areaBasis: "declared_land",
        parameters: {
          fos: "0.8",
          fot: null,
          heightMaxM: "38.5",
          floorsMax: 13,
        },
      }),
    ).toMatchObject({
      buildableM2: "2080.00",
      binding: "height",
      sensitivity: [],
    });
  });

  it("caps the FOT by height and names what is missing", () => {
    expect(
      buildableEnvelope({
        landAreaM2: "100",
        areaBasis: "parcel",
        parameters: { fos: "0.5", fot: "5", heightMaxM: null, floorsMax: 2 },
      }),
    ).toMatchObject({ buildableM2: "100.00", binding: "height" });
    expect(
      buildableEnvelope({
        landAreaM2: "100",
        areaBasis: "parcel",
        parameters: { fos: null, fot: "1", heightMaxM: null, floorsMax: null },
      }),
    ).toEqual({ status: "unavailable", reason: "fos_not_published" });
    expect(
      buildableEnvelope({
        landAreaM2: "100",
        areaBasis: "parcel",
        parameters: {
          fos: "0.6",
          fot: null,
          heightMaxM: null,
          floorsMax: null,
        },
      }),
    ).toEqual({
      status: "unavailable",
      reason: "fot_and_height_not_published",
    });
    expect(
      buildableEnvelope({
        landAreaM2: null,
        areaBasis: null,
        parameters: null,
      }),
    ).toEqual({ status: "unavailable", reason: "zoning_unknown" });
  });

  it.each([
    ["10.5", 3],
    ["23.5", 8],
    ["38.5", 13],
    ["15", 5],
    ["13.5", 4],
    ["18", 6],
    ["21", 7],
    ["3", null],
  ])("derives %s m as %s floors with 3,5 + 2,8 m", (height, floors) => {
    expect(floorsFromHeight(height)).toBe(floors);
  });
});

describe("listing-location-1.0.0", () => {
  const resolve = (
    overrides: Partial<LocationListing>,
    parcels: readonly ParcelAtPoint[] | undefined,
  ) =>
    resolveListingLocation({
      listing: listing(overrides),
      pinShared: false,
      geocode: matched(-31.4282, -64.1885),
      parcelsAt: () => parcels,
      zoningQueryFor: () => null,
      barrios,
      zoning,
    });

  it("reads barrio, parcel and zone from the pin at once", () => {
    const reading = resolve({}, [parcel("310")]);
    expect(reading).toMatchObject({
      precision: "portal_pin",
      barrio: { name: "BARRIO SINTÉTICO", official: true },
      parcel: { status: "matched" },
      zoning: { confidence: "official_map", pattern: "8256-G1" },
      layers: { barrios: barrios.releaseId, zoning: zoning.releaseId },
    });
    expect(
      envelopeOf({ reading, propertyType: "house", landAreaM2: "300" }),
    ).toMatchObject({ areaBasis: "parcel", landAreaM2: "310" });
  });

  it("keeps a mismatched parcel as a candidate and builds on the listing's land", () => {
    const reading = resolve({}, [parcel("11588")]);
    expect(reading.parcel.status).toBe("area_mismatch");
    expect(
      envelopeOf({ reading, propertyType: "house", landAreaM2: "300" }),
    ).toMatchObject({ areaBasis: "declared_land", landAreaM2: "300" });
    expect(
      envelopeOf({ reading, propertyType: "apartment", landAreaM2: null }),
    ).toBeNull();
  });

  it("marks the parcel pending until IDECOR answers", () => {
    expect(resolve({}, undefined).parcel.status).toBe("pending");
    expect(
      pendingLookups({
        listing: listing(),
        pinShared: false,
        geocode: undefined,
        parcelsAt: () => undefined,
      }),
    ).toEqual({
      addressKey: "rondeau 500",
      pointKey: "-31.4280000,-64.1880000",
    });
    // Una altura exacta pendiente puede ganarle al pin: el punto espera.
    expect(
      pendingLookups({
        listing: listing({ addressDeclared: "Rondeau 517" }),
        pinShared: false,
        geocode: undefined,
        parcelsAt: () => undefined,
      }).pointKey,
    ).toBeNull();
    expect(pointKey({ latitude: -31.4, longitude: -64.2 })).toBe(
      "-31.4000000,-64.2000000",
    );
  });

  it("hashes what the reading read, not the listing revision or its price", () => {
    const hash = (overrides: Partial<LocationListing>, zoningRelease: string) =>
      locationInputHash({
        listing: listing(overrides),
        pinShared: false,
        geocode: matched(-31.4282, -64.1885),
        parcelsAt: () => [parcel("310")],
        zoningQueryFor: () => null,
        barriosRelease: barrios.releaseId,
        zoningRelease,
      });
    const base = hash({}, zoning.releaseId);
    expect(hash({ revision: 7 }, zoning.releaseId)).toBe(base);
    expect(hash({ latitude: "-31.4281" }, zoning.releaseId)).not.toBe(base);
    expect(hash({}, "00000000-0000-4000-8000-000000000009")).not.toBe(base);
  });

  it("writes the provincial nomenclature as Catastro reads it", () => {
    expect(formatNomenclature("1101010409014065")).toBe(
      "11-01-01-04-09-014-065",
    );
  });
});
