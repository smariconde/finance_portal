import type { MultiPolygon } from "../domain/geo-geometry";
import type { ZoningFeatureProperties } from "../domain/idecor-wfs";

/**
 * Fixtures sintéticas de la ubicación (`F13-06`), con la **forma** de cada
 * cable medido el 2026-11-28 y valores inventados: ninguna respuesta real de
 * Georef, IDECOR o la Municipalidad entra al repositorio.
 *
 * Una cuadrícula imaginaria al sur del centro de Córdoba: dos zonas que
 * comparten un borde sobre una calle norte–sur en `lon = -64.18`, un convenio
 * urbanístico y un barrio con un hueco.
 */
const square = (
  west: number,
  south: number,
  east: number,
  north: number,
): MultiPolygon => [
  [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
];

export const ZONE_WEST = square(-64.19, -31.43, -64.18, -31.42);
export const ZONE_EAST = square(-64.18, -31.43, -64.17, -31.42);
export const AGREEMENT = square(-64.19, -31.44, -64.18, -31.435);

const base: ZoningFeatureProperties = {
  ord_y_perfil: "8256-G1",
  perfil_o_zona: "G1",
  zona: "ZONA G1",
  ord_original: "Ord. 8256/86",
  ord_modificatoria: null,
  caracter_urbanistico: "RESIDENCIAL DE BAJA DENSIDAD.",
  fos: 70,
  fot: 1,
  altura_maxima: 10.5,
  pisos_maximos: "Planta Baja + 2 pisos",
  plano_a_45: null,
  enlace_grafico: null,
};

const feature = (
  id: string,
  geometry: MultiPolygon,
  properties: Partial<ZoningFeatureProperties>,
) => ({
  type: "Feature",
  id,
  geometry: { type: "MultiPolygon", coordinates: geometry },
  geometry_name: "geom",
  properties: { fid: 1, ...base, ...properties },
});

/** Lo que devuelve el WFS por la capa entera, en miniatura. */
export function syntheticZoningLayer(
  overrides: { numberMatched?: number; drop?: string } = {},
): string {
  const features = [
    feature("CBA_Ordenanza_8256.1", ZONE_WEST, {}),
    feature("CBA_Ordenanza_8256.2", ZONE_EAST, {
      ord_y_perfil: "8057-PERFIL X",
      zona: "ZONA 5",
      fos: 80,
      fot: null,
      altura_maxima: 38.5,
      pisos_maximos: "Planta Baja + 12 pisos",
    }),
    feature("CBA_Ordenanza_8256.3", AGREEMENT, {
      ord_y_perfil: "12077-CONVENIO URBANISTICO",
      fos: 2,
      fot: 0.4,
      altura_maxima: 10.5,
      pisos_maximos: null,
    }),
  ].map((item) => {
    if (overrides.drop === undefined) return item;
    const properties: Record<string, unknown> = { ...item.properties };
    delete properties[overrides.drop];
    return { ...item, properties };
  });
  return JSON.stringify({
    type: "FeatureCollection",
    features,
    totalFeatures: features.length,
    numberMatched: overrides.numberMatched ?? features.length,
    numberReturned: features.length,
    timeStamp: "2026-11-28T03:21:56.764Z",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4326" } },
  });
}

/** Las parcelas bajo un punto; la capa repite una por versión. */
export function syntheticParcelsAt(
  parcels: readonly {
    nomenclature: string;
    area: number | null;
    state?: string;
  }[],
): string {
  const features = parcels.map((parcel, index) => ({
    type: "Feature",
    id: `parcelas.${1000 + index}`,
    geometry: { type: "MultiPolygon", coordinates: ZONE_WEST },
    geometry_name: "geom",
    properties: {
      Nomenclatura: parcel.nomenclature,
      Tipo_Parcela: "URBANO",
      Estado: parcel.state ?? "EDIFICADO NoPH",
      Superficie_Tierra_Urbana: parcel.area,
    },
  }));
  return JSON.stringify({
    type: "FeatureCollection",
    features,
    totalFeatures: features.length,
    numberMatched: features.length,
    numberReturned: features.length,
  });
}

/** Una dirección de un lote de Georef, aplanada como la pide el portal. */
export function syntheticGeorefMatch(input: {
  street: string;
  number: number;
  latitude: number;
  longitude: number;
  department?: string;
}) {
  return {
    cantidad: 1,
    direcciones: [
      {
        altura_unidad: null,
        altura_valor: input.number,
        calle_categoria: "CALLE",
        calle_id: "1401401099999",
        calle_nombre: input.street.toUpperCase(),
        departamento_id: input.department ?? "14014",
        departamento_nombre: "Capital",
        nomenclatura: `${input.street.toUpperCase()} ${input.number}, Capital, Córdoba`,
        ubicacion_lat: input.latitude,
        ubicacion_lon: input.longitude,
      },
    ],
    inicio: 0,
    total: 1,
  };
}

export const GEOREF_NOT_FOUND = {
  cantidad: 0,
  direcciones: [],
  inicio: 0,
  total: 0,
};

/** Un KML de barrios con la forma del de Catastro; al menos 100 polígonos. */
export function syntheticBarriosKml(
  options: { withoutName?: boolean } = {},
): string {
  const ring = (coordinates: MultiPolygon[number][number]) =>
    coordinates.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
  const placemark = (
    id: number,
    name: string,
    kind: string,
    legal: string,
    polygon: MultiPolygon[number],
  ) => `
    <Placemark id="ID_${String(id).padStart(5, "0")}">
      <name> </name>
      <description><![CDATA[<table><tr><td>AntecedentesLegales</td>
<td>${legal}</td></tr><tr><td>Nombre</td>
<td>${options.withoutName && id === 0 ? "" : name}</td></tr><tr><td>TipoBarrio</td>
<td>${kind}</td></tr></table>]]></description>
      <MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(polygon[0])}</coordinates></LinearRing></outerBoundaryIs>${polygon
        .slice(1)
        .map(
          (hole) =>
            `<innerBoundaryIs><LinearRing><coordinates>${ring(hole)}</coordinates></LinearRing></innerBoundaryIs>`,
        )
        .join("")}</Polygon></MultiGeometry>
    </Placemark>`;
  const hole = square(-64.186, -31.426, -64.184, -31.424)[0][0];
  const body = [
    placemark(0, "BARRIO SINTÉTICO", "BarrioOficial", "ORD 1/26", [
      ...ZONE_WEST[0],
      hole,
    ]),
    placemark(
      1,
      "VILLA DE PRUEBA",
      "BarrioNoOficial",
      "&lt;Null&gt;",
      ZONE_EAST[0],
    ),
    ...Array.from({ length: 100 }, (_, index) =>
      placemark(
        index + 2,
        `RELLENO ${index}`,
        "BarrioOficial",
        "ORD 2/26",
        square(
          -64.0 - index * 0.001,
          -31.3,
          -63.999 - index * 0.001,
          -31.299,
        )[0],
      ),
    ),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document id="Barrio"><Folder id="FeatureLayer0">${body}</Folder></Document></kml>`;
}
