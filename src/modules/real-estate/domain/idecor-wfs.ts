import { z } from "zod";

import {
  boundingBoxOf,
  multiPolygonSchema,
  type GeoPoint,
  type LayerFeature,
  type MultiPolygon,
} from "./geo-geometry";

/**
 * Las capas de IDECOR que lee la Fase 13, por su WFS
 * (`idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs`, CC BY-SA 4.0).
 * Medido el 2026-11-28:
 *
 * - `idecor:CBA_Ordenanza_8256` (Ocupación del Suelo de la Municipalidad de
 *   Córdoba, con sus modificatorias): 600 multipolígonos, 2,4 MB en GeoJSON
 *   EPSG:4326. Se baja **entera** como una release y el punto en polígono corre
 *   en código: un pin por aviso no le pregunta nada a IDECOR. Cubre 360 de 364
 *   pines reales. FOS en porcentaje, FOT como factor, altura en metros y pisos
 *   como texto («Planta Baja + 2 pisos»).
 * - `idecor:parcelas` (el parcelario provincial): se consulta **por punto**
 *   (`INTERSECTS`), un pedido por pin, porque Capital son cientos de miles de
 *   parcelas. Trae la nomenclatura provincial de 16 dígitos, la superficie de
 *   tierra y el estado; ni la cuenta ni la valuación entran.
 *
 * `idecor-wfs-geojson-1.0.0` cierra el envelope: una colección truncada
 * (`numberMatched ≠ numberReturned`) o una columna que dejó de venir rechazan
 * la respuesta entera por nombre.
 */
export const IDECOR_WFS_PARSER_VERSION = "idecor-wfs-geojson-1.0.0";
export const IDECOR_WFS_BASE =
  "https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs";
export const ZONING_LAYER_ID = "idecor.cba-ordenanza-8256";
export const ZONING_LAYER_TYPE = "idecor:CBA_Ordenanza_8256";
export const PARCELS_DATASET = "idecor.parcelas";
const PARCELS_TYPE = "idecor:parcelas";

/** El tope de la colección: la capa tiene 600 y crece con cada ordenanza. */
const MAX_LAYER_FEATURES = 5000;

const wfsQuery = (params: Record<string, string>) =>
  `${IDECOR_WFS_BASE}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    ...params,
  }).toString()}`;

export function zoningLayerUrl(): string {
  return wfsQuery({
    typeNames: ZONING_LAYER_TYPE,
    count: String(MAX_LAYER_FEATURES),
  });
}

const PARCEL_COLUMNS = [
  "Nomenclatura",
  "Tipo_Parcela",
  "Estado",
  "Superficie_Tierra_Urbana",
] as const;

/** Las parcelas que contienen un punto. */
export function parcelsAtUrl(point: GeoPoint): string {
  const lon = point.longitude.toFixed(7);
  const lat = point.latitude.toFixed(7);
  return wfsQuery({
    typeNames: PARCELS_TYPE,
    propertyName: PARCEL_COLUMNS.join(","),
    count: "10",
    cql_filter: `INTERSECTS(geom,SRID=4326;POINT(${lon} ${lat}))`,
  });
}

export class IdecorParseError extends Error {
  constructor(
    readonly code:
      | "wfs_body_invalid"
      | "wfs_truncated"
      | "wfs_columns_changed"
      | "wfs_geometry_invalid"
      | "wfs_too_many_features",
  ) {
    super(code);
    this.name = "IdecorParseError";
  }
}

const collectionSchema = z.looseObject({
  type: z.literal("FeatureCollection"),
  numberMatched: z.number().int().min(0),
  numberReturned: z.number().int().min(0),
  features: z.array(
    z.looseObject({
      id: z.string().min(1).max(128),
      geometry: z
        .looseObject({ type: z.string(), coordinates: z.unknown() })
        .nullable(),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});

function readCollection(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new IdecorParseError("wfs_body_invalid");
  }
  const parsed = collectionSchema.safeParse(json);
  if (!parsed.success) throw new IdecorParseError("wfs_body_invalid");
  const collection = parsed.data;
  if (
    collection.numberMatched !== collection.numberReturned ||
    collection.numberReturned !== collection.features.length
  )
    throw new IdecorParseError("wfs_truncated");
  if (collection.features.length > MAX_LAYER_FEATURES)
    throw new IdecorParseError("wfs_too_many_features");
  return collection.features;
}

function geometryOf(geometry: {
  readonly type: string;
  readonly coordinates: unknown;
}): MultiPolygon {
  const coordinates =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : null;
  const parsed = multiPolygonSchema.safeParse(
    // Sólo dos dimensiones: una tercera coordenada se descarta.
    Array.isArray(coordinates)
      ? coordinates.map((polygon: unknown) =>
          Array.isArray(polygon)
            ? polygon.map((ring: unknown) =>
                Array.isArray(ring)
                  ? ring.map((point: unknown) =>
                      Array.isArray(point) ? point.slice(0, 2) : point,
                    )
                  : ring,
              )
            : polygon,
        )
      : null,
  );
  if (!parsed.success) throw new IdecorParseError("wfs_geometry_invalid");
  return parsed.data as MultiPolygon;
}

/** Los campos de la 8256 que se guardan, tal como los publica la capa. */
export const ZONING_COLUMNS = [
  "ord_y_perfil",
  "perfil_o_zona",
  "zona",
  "ord_original",
  "ord_modificatoria",
  "caracter_urbanistico",
  "fos",
  "fot",
  "altura_maxima",
  "pisos_maximos",
  "plano_a_45",
  "enlace_grafico",
] as const;

export type ZoningColumn = (typeof ZONING_COLUMNS)[number];
export type ZoningFeatureProperties = Readonly<
  Record<ZoningColumn, string | number | null>
>;

const cell = (value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed.slice(0, 600);
  }
  return null;
};

export type ParsedLayerFeature<P> = Omit<LayerFeature<P>, "box">;

export function parseZoningLayer(
  text: string,
): ParsedLayerFeature<ZoningFeatureProperties>[] {
  const features = readCollection(text);
  if (features.length === 0) throw new IdecorParseError("wfs_body_invalid");
  return features.map((feature) => {
    for (const column of ZONING_COLUMNS)
      if (!(column in feature.properties))
        throw new IdecorParseError("wfs_columns_changed");
    if (feature.geometry === null)
      throw new IdecorParseError("wfs_geometry_invalid");
    const properties = Object.fromEntries(
      ZONING_COLUMNS.map((column) => [
        column,
        cell(feature.properties[column]),
      ]),
    ) as ZoningFeatureProperties;
    return {
      key: feature.id,
      geometry: geometryOf(feature.geometry),
      properties,
    };
  });
}

export type ParcelAtPoint = {
  /** La nomenclatura provincial: 16 dígitos (departamento, pedanía, …). */
  readonly nomenclature: string;
  readonly landAreaM2: string | null;
  readonly state: string | null;
  readonly parcelType: string | null;
};

export const parcelAtPointSchema: z.ZodType<ParcelAtPoint> = z.strictObject({
  nomenclature: z.string().regex(/^\d{16}$/u),
  landAreaM2: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u)
    .nullable(),
  state: z.string().max(60).nullable(),
  parcelType: z.string().max(60).nullable(),
});

/** Un número de la capa a decimal canónico; cero o negativo no es superficie. */
export function canonicalArea(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  // `String` da el decimal más corto que vuelve al mismo double: el del cable.
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/u.test(text)) return null;
  return text.includes(".")
    ? text.replace(/0+$/u, "").replace(/\.$/u, "")
    : text;
}

/**
 * Las parcelas distintas bajo un punto. La capa repite una parcela por
 * versión y, si está sometida a propiedad horizontal, la publica también con
 * 21 dígitos —los 16 de la parcela y 5 del régimen PH— (medido el 2026-11-28
 * en un edificio de Alta Córdoba). Los primeros 16 son la parcela; la fila de
 * 16 manda sobre la de PH.
 */
export function parseParcelsAt(text: string): ParcelAtPoint[] {
  const features = readCollection(text);
  const byNomenclature = new Map<string, ParcelAtPoint>();
  const ordered = [...features].sort(
    (left, right) =>
      String(left.properties.Nomenclatura).length -
      String(right.properties.Nomenclatura).length,
  );
  for (const feature of ordered) {
    for (const column of PARCEL_COLUMNS)
      if (!(column in feature.properties))
        throw new IdecorParseError("wfs_columns_changed");
    const published = feature.properties.Nomenclatura;
    if (typeof published !== "string" || !/^\d{16}(?:\d{5})?$/u.test(published))
      throw new IdecorParseError("wfs_body_invalid");
    const nomenclature = published.slice(0, 16);
    if (byNomenclature.has(nomenclature)) continue;
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() !== ""
        ? value.trim().slice(0, 60)
        : null;
    byNomenclature.set(nomenclature, {
      nomenclature,
      landAreaM2: canonicalArea(feature.properties.Superficie_Tierra_Urbana),
      state: text(feature.properties.Estado),
      parcelType: text(feature.properties.Tipo_Parcela),
    });
  }
  return [...byNomenclature.values()];
}

/** Una release guardada vuelve con su caja calculada. */
export function withBox<P>(feature: ParsedLayerFeature<P>): LayerFeature<P> {
  return { ...feature, box: boundingBoxOf(feature.geometry) };
}
