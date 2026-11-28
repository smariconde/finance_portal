import { describe, expect, it } from "vitest";

import {
  GEOREF_NOT_FOUND,
  syntheticBarriosKml,
  syntheticGeorefMatch,
  syntheticParcelsAt,
  syntheticZoningLayer,
  ZONE_WEST,
} from "../infrastructure/synthetic-location";
import { BarriosParseError, parseBarriosKml } from "./cordoba-barrios";
import {
  distanceToMultiPolygonMeters,
  haversineMeters,
  multiPolygonContains,
  polygonsAt,
  polygonsNear,
} from "./geo-geometry";
import {
  classifyDeclaredAddress,
  georefBatchBody,
  GeorefParseError,
  parseGeorefBatch,
} from "./georef-addresses";
import {
  canonicalArea,
  IdecorParseError,
  parcelsAtUrl,
  parseParcelsAt,
  parseZoningLayer,
  withBox,
} from "./idecor-wfs";

describe("point-in-polygon-1.0.0", () => {
  it("counts a point inside the ring and outside its hole", () => {
    const [barrio] = parseBarriosKml(syntheticBarriosKml());
    expect(
      multiPolygonContains(barrio.geometry, {
        latitude: -31.428,
        longitude: -64.188,
      }),
    ).toBe(true);
    // El hueco del barrio sintético.
    expect(
      multiPolygonContains(barrio.geometry, {
        latitude: -31.425,
        longitude: -64.185,
      }),
    ).toBe(false);
  });

  it("measures meters to the nearest edge and zero inside", () => {
    expect(
      distanceToMultiPolygonMeters(ZONE_WEST, {
        latitude: -31.425,
        longitude: -64.185,
      }),
    ).toBe(0);
    // 0,001° de longitud a -31,4° son ~95 m.
    const outside = distanceToMultiPolygonMeters(ZONE_WEST, {
      latitude: -31.425,
      longitude: -64.179,
    });
    expect(outside).toBeGreaterThan(90);
    expect(outside).toBeLessThan(100);
    expect(
      Math.round(
        haversineMeters(
          { latitude: -31.425, longitude: -64.18 },
          { latitude: -31.425, longitude: -64.179 },
        ),
      ),
    ).toBe(95);
  });

  it("finds the polygons at and near a point through their boxes", () => {
    const features = parseZoningLayer(syntheticZoningLayer()).map(withBox);
    const onStreet = { latitude: -31.425, longitude: -64.18 };
    expect(polygonsNear(features, onStreet, 25)).toHaveLength(2);
    expect(
      polygonsAt(features, { latitude: -31.425, longitude: -64.185 }).map(
        (feature) => feature.key,
      ),
    ).toEqual(["CBA_Ordenanza_8256.1"]);
  });
});

describe("declared-address-1.0.0", () => {
  it.each([
    ["Rincón 900", { kind: "street_number", rounded: true, number: 900 }],
    ["La Pasionaria 1735", { kind: "street_number", rounded: false }],
    ["Calle Publica Manzana 61 Lote 5", { kind: "lot_designation" }],
    ["Mza 111 Lote", { kind: "lot_designation" }],
    ["S/n Lote 04 Manzana 108", { kind: "lot_designation" }],
    ["Ruta Nacional 9 Km 690 S/N", { kind: "lot_designation" }],
    ["Calle Desconocida", { kind: "placeholder_street" }],
    ["Avenida Figueroa Alcorta", { kind: "no_number" }],
    ["Juan del Campillo 1140 1100", { kind: "several_numbers" }],
    ["Roma 0", { kind: "no_number" }],
  ])("classifies «%s»", (text, expected) => {
    expect(classifyDeclaredAddress(text)).toMatchObject(expected);
  });

  it("normalizes the key without accents or case", () => {
    expect(classifyDeclaredAddress("Avenida Colón  5000")).toMatchObject({
      addressKey: "avenida colon 5000",
    });
    expect(classifyDeclaredAddress(null)).toEqual({ kind: "missing" });
  });
});

describe("georef-direcciones-1.0.0", () => {
  const queries = [
    { addressKey: "rondeau 500", street: "rondeau", number: 500 },
    { addressKey: "mendoza 111", street: "mendoza", number: 111 },
    { addressKey: "colon 99", street: "colon", number: 99 },
    { addressKey: "lejos 100", street: "lejos", number: 100 },
    { addressKey: "afuera 100", street: "afuera", number: 100 },
  ];

  it("asks the province and the department, one result each", () => {
    const body = JSON.parse(georefBatchBody(queries.slice(0, 1)));
    expect(body.direcciones[0]).toEqual({
      direccion: "rondeau 500",
      provincia: "14",
      departamento: "14014",
      max: 1,
      aplanar: true,
    });
    expect(() => georefBatchBody([])).toThrow("georef_batch_size");
  });

  it("accepts only the same number in Capital and inside the city", () => {
    const text = JSON.stringify({
      resultados: [
        syntheticGeorefMatch({
          street: "Rondeau",
          number: 500,
          latitude: -31.424,
          longitude: -64.18,
        }),
        GEOREF_NOT_FOUND,
        syntheticGeorefMatch({
          street: "Colon",
          number: 100,
          latitude: -31.4,
          longitude: -64.2,
        }),
        syntheticGeorefMatch({
          street: "Lejos",
          number: 100,
          latitude: -31.9,
          longitude: -64.2,
        }),
        syntheticGeorefMatch({
          street: "Afuera",
          number: 100,
          latitude: -31.4,
          longitude: -64.2,
          department: "14021",
        }),
      ],
    });
    expect(parseGeorefBatch(text, queries).map((r) => r.status)).toEqual([
      "matched",
      "not_found",
      "number_not_matched",
      "outside_capital",
      "outside_capital",
    ]);
  });

  it("refuses a body that is not the batch it asked for", () => {
    expect(() => parseGeorefBatch("<html>", queries)).toThrow(GeorefParseError);
    expect(() =>
      parseGeorefBatch(JSON.stringify({ resultados: [] }), queries),
    ).toThrow("georef_result_count");
  });
});

describe("idecor-wfs-geojson-1.0.0", () => {
  it("reads the whole layer with its declared columns", () => {
    const features = parseZoningLayer(syntheticZoningLayer());
    expect(features).toHaveLength(3);
    expect(features[0].properties).toMatchObject({
      ord_y_perfil: "8256-G1",
      fos: 70,
      fot: 1,
      pisos_maximos: "Planta Baja + 2 pisos",
    });
  });

  it("refuses a truncated collection and a column that stopped coming", () => {
    expect(() =>
      parseZoningLayer(syntheticZoningLayer({ numberMatched: 600 })),
    ).toThrow("wfs_truncated");
    expect(() =>
      parseZoningLayer(syntheticZoningLayer({ drop: "fot" })),
    ).toThrow("wfs_columns_changed");
    expect(() => parseZoningLayer("{")).toThrow(IdecorParseError);
  });

  it("joins the versions of one parcel and keeps its area as published", () => {
    const parcels = parseParcelsAt(
      syntheticParcelsAt([
        { nomenclature: "1101010409014065", area: 775.19 },
        { nomenclature: "1101010409014065", area: 775.19 },
      ]),
    );
    expect(parcels).toEqual([
      {
        nomenclature: "1101010409014065",
        landAreaM2: "775.19",
        state: "EDIFICADO NoPH",
        parcelType: "URBANO",
      },
    ]);
    // La misma parcela en régimen PH, con 21 dígitos, se une a la de 16.
    expect(
      parseParcelsAt(
        syntheticParcelsAt([
          {
            nomenclature: "110101154100500100000",
            area: 15387.144,
            state: "EDIFICADO PH",
          },
          { nomenclature: "1101011541005001", area: 15387.14 },
        ]),
      ),
    ).toEqual([
      {
        nomenclature: "1101011541005001",
        landAreaM2: "15387.14",
        state: "EDIFICADO NoPH",
        parcelType: "URBANO",
      },
    ]);
    expect(canonicalArea(0)).toBeNull();
    expect(canonicalArea(300)).toBe("300");
    expect(() =>
      parseParcelsAt(syntheticParcelsAt([{ nomenclature: "11-01", area: 1 }])),
    ).toThrow("wfs_body_invalid");
  });

  it("asks one point with the parcel columns only", () => {
    const url = new URL(
      parcelsAtUrl({ latitude: -31.424761, longitude: -64.181332 }),
    );
    expect(url.pathname).toBe("/geoserver/idecor/wfs");
    expect(url.searchParams.get("cql_filter")).toBe(
      "INTERSECTS(geom,SRID=4326;POINT(-64.1813320 -31.4247610))",
    );
    expect(url.searchParams.get("propertyName")).not.toContain("Cuenta");
  });
});

describe("cordoba-barrios-kml-1.0.0", () => {
  it("reads name, kind and legal basis, with <Null> as absent", () => {
    const [first, second] = parseBarriosKml(syntheticBarriosKml());
    expect(first.properties).toEqual({
      name: "BARRIO SINTÉTICO",
      barrioKey: "barrio sintetico",
      official: true,
      legalBasis: "ORD 1/26",
    });
    expect(first.geometry[0]).toHaveLength(2);
    expect(second.properties).toMatchObject({
      official: false,
      legalBasis: null,
    });
  });

  it("refuses a placemark without a name and a file too small", () => {
    expect(() =>
      parseBarriosKml(syntheticBarriosKml({ withoutName: true })),
    ).toThrow(BarriosParseError);
    expect(() => parseBarriosKml("<kml></kml>")).toThrow(
      "kml_placemarks_out_of_range",
    );
  });
});
