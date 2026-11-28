import {
  decodeXmlText,
  readZipXmlPart,
} from "@/modules/reference-data/domain/xlsx-sheet-reader";

import { multiPolygonSchema, type MultiPolygon } from "./geo-geometry";
import type { ParsedLayerFeature } from "./idecor-wfs";
import { normalizeAddressText } from "./georef-addresses";

/**
 * Los barrios de la ciudad de Córdoba que publica la Municipalidad (Dirección
 * de Catastro, «Mapa de barrios de la ciudad - 2023», CC BY-SA AR): un KMZ de
 * 524 KB con un `doc.kml` de 485 polígonos. IDECOR no tiene barrios de
 * Capital. Medido el 2026-11-28: 423 oficiales y 62 «no oficiales», 452
 * nombres distintos —un barrio puede ser varios polígonos— y 350 de 364 pines
 * reales caen en uno. El barrio sale de acá, nunca del texto de la agencia.
 *
 * `cordoba-barrios-kml-1.0.0` lee cada `Placemark` por su tabla de atributos
 * (`Nombre`, `TipoBarrio`, `AntecedentesLegales`) y sus polígonos; un atributo
 * que falta, un nombre vacío o una geometría rota rechazan el archivo entero.
 */
export const CORDOBA_BARRIOS_PARSER_VERSION = "cordoba-barrios-kml-1.0.0";
export const BARRIOS_LAYER_ID = "cordoba.barrios";
export const BARRIOS_KMZ_URL =
  "https://gobiernoabierto.cordoba.gob.ar/datos/recurso/18854/Barrio_1.kmz";

/** El `doc.kml` pesa 2,1 MB inflado. */
const KML_MAX_BYTES = 12 * 1024 * 1024;
const MIN_PLACEMARKS = 100;
const MAX_PLACEMARKS = 5000;

export type BarrioProperties = {
  readonly name: string;
  /** El nombre normalizado: la identidad del barrio entre polígonos. */
  readonly barrioKey: string;
  readonly official: boolean;
  readonly legalBasis: string | null;
};

export class BarriosParseError extends Error {
  constructor(
    readonly code:
      | "kmz_unreadable"
      | "kml_placemarks_out_of_range"
      | "kml_attribute_missing"
      | "kml_geometry_invalid",
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}:${detail}`);
    this.name = "BarriosParseError";
  }
}

const attribute = (placemark: string, name: string): string | null => {
  const match = new RegExp(`<td>${name}</td>\\s*<td>([^<]*)</td>`, "u").exec(
    placemark,
  );
  if (match === null) return null;
  const value = decodeXmlText(match[1]).trim();
  return value === "" || value === "<Null>" ? "" : value;
};

function polygonsOf(placemark: string): MultiPolygon {
  const polygons = [
    ...placemark.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/gu),
  ].map((polygon) =>
    [
      ...polygon[1].matchAll(
        /<(outer|inner)BoundaryIs>\s*<LinearRing>\s*<coordinates>([\s\S]*?)<\/coordinates>/gu,
      ),
    ]
      .sort((a, b) => (a[1] === b[1] ? 0 : a[1] === "outer" ? -1 : 1))
      .map((ring) =>
        ring[2]
          .trim()
          .split(/\s+/u)
          .map((tuple) => tuple.split(",").slice(0, 2).map(Number)),
      ),
  );
  const parsed = multiPolygonSchema.safeParse(polygons);
  if (!parsed.success) throw new BarriosParseError("kml_geometry_invalid");
  // Un anillo exterior por polígono, primero: los huecos van detrás.
  return parsed.data as MultiPolygon;
}

export function parseBarriosKml(
  kml: string,
): ParsedLayerFeature<BarrioProperties>[] {
  const placemarks = [
    ...kml.matchAll(/<Placemark id="([^"]{1,64})">([\s\S]*?)<\/Placemark>/gu),
  ];
  if (placemarks.length < MIN_PLACEMARKS || placemarks.length > MAX_PLACEMARKS)
    throw new BarriosParseError("kml_placemarks_out_of_range");
  return placemarks.map(([, id, body]) => {
    const name = attribute(body, "Nombre");
    const kind = attribute(body, "TipoBarrio");
    const legal = attribute(body, "AntecedentesLegales");
    if (name === null || name === "" || kind === null || legal === null)
      throw new BarriosParseError("kml_attribute_missing", id);
    if (kind !== "BarrioOficial" && kind !== "BarrioNoOficial")
      throw new BarriosParseError("kml_attribute_missing", id);
    return {
      key: id,
      geometry: polygonsOf(body),
      properties: {
        name,
        barrioKey: normalizeAddressText(name),
        official: kind === "BarrioOficial",
        legalBasis: legal === "" ? null : legal.slice(0, 300),
      },
    };
  });
}

/** El KMZ tal como baja: un zip con `doc.kml`. */
export function parseBarriosKmz(
  bytes: Uint8Array,
): ParsedLayerFeature<BarrioProperties>[] {
  const read = readZipXmlPart(bytes, "doc.kml", {
    maxPartBytes: KML_MAX_BYTES,
    maxTotalBytes: KML_MAX_BYTES,
  });
  if (!read.ok) throw new BarriosParseError("kmz_unreadable", read.code);
  return parseBarriosKml(read.xml);
}
