import {
  buildableEnvelope,
  type BuildableEnvelope,
  type EnvelopeAreaBasis,
} from "./buildable-envelope";
import type { PropertyType } from "./listing-capture";
import type { LocationReading, ParcelStatus } from "./listing-location";
import type { LocationPrecision } from "./location-precision";
import type { ZoningConfidence, ZoningMissing } from "./zoning-resolution";

/**
 * Lo que la ficha muestra de la ubicación (`location-view-1.0.0`): etiquetas
 * cortas y la envolvente, que se calcula al leer —nunca se guarda— sobre la
 * superficie que corresponde. Sólo una casa, un PH o un terreno tienen lote
 * propio: un departamento comparte la parcela del edificio.
 */
export const LOCATION_VIEW_VERSION = "location-view-1.0.0";

export const PRECISION_LABELS: Readonly<Record<LocationPrecision, string>> = {
  address_geocoded: "Dirección exacta",
  portal_pin: "Pin del portal",
  address_block: "Cuadra",
  portal_pin_shared: "Pin compartido",
  neighborhood_only: "Sólo barrio",
  unlocated: "Sin ubicación",
};

export const PRECISION_DETAILS: Readonly<Record<LocationPrecision, string>> = {
  address_geocoded: "Georef resolvió la dirección con su altura.",
  portal_pin: "El pin que publicó el portal, no repetido.",
  address_block:
    "La altura viene redondeada a la centena: ubica la cuadra, no la casa.",
  portal_pin_shared:
    "Otros avisos con otra dirección usan el mismo pin: es el centro de la zona.",
  neighborhood_only: "Sin pin ni dirección con número.",
  unlocated: "El aviso no publica dónde está.",
};

export const PARCEL_STATUS_LABELS: Readonly<Record<ParcelStatus, string>> = {
  matched: "Superficie coincide",
  building_parcel: "Parcela del edificio",
  area_unverified: "Sin superficie para comparar",
  area_mismatch: "Superficie no coincide",
  no_parcel_at_point: "El punto cae en la calle",
  several_parcels: "Varias parcelas",
  not_located: "La ubicación no alcanza",
  pending: "Consultando IDECOR",
};

export const ZONING_CONFIDENCE_LABELS: Readonly<
  Record<ZoningConfidence, string>
> = {
  official_query: "Consulta al municipio",
  official_map: "Mapa oficial",
  corridor_inferred: "Inferida del entorno",
  unknown: "Desconocida",
};

export const ZONING_UNKNOWN_LABELS: Readonly<
  Record<
    Extract<LocationReading["zoning"], { confidence: "unknown" }>["reason"],
    string
  >
> = {
  no_location: "Sin un punto para ubicarla",
  shared_pin: "El pin es el centro de la zona",
  outside_layer: "Fuera de la capa",
  several_zones: "Varias zonas a 25 m",
  layer_unavailable: "La capa todavía no se bajó",
};

export const ZONING_MISSING_LABELS: Readonly<Record<ZoningMissing, string>> = {
  fos_not_published: "FOS",
  fot_not_published: "FOT",
  height_not_published: "altura",
  floors_not_published: "pisos",
  special_agreement: "convenio urbanístico",
};

export const ENVELOPE_AREA_LABELS: Readonly<Record<EnvelopeAreaBasis, string>> =
  {
    parcel: "parcela",
    parcel_unverified: "parcela, sin verificar",
    declared_land: "terreno del aviso",
  };

export const ENVELOPE_UNAVAILABLE_LABELS: Readonly<
  Record<
    Extract<BuildableEnvelope, { status: "unavailable" }>["reason"],
    string
  >
> = {
  land_area_missing: "Sin superficie de terreno",
  zoning_unknown: "Sin zonificación",
  fos_not_published: "La zona no publica FOS",
  fot_and_height_not_published: "La zona no publica FOT ni altura",
};

const OWN_LOT: ReadonlySet<PropertyType> = new Set(["house", "ph", "land"]);

/** La envolvente del lote, o `null` si el inmueble no tiene lote propio. */
export function envelopeOf(input: {
  readonly reading: LocationReading;
  readonly propertyType: PropertyType;
  readonly landAreaM2: string | null;
}): BuildableEnvelope | null {
  if (!OWN_LOT.has(input.propertyType)) return null;
  const { parcel, zoning } = input.reading;
  let area: string | null = input.landAreaM2;
  let basis: EnvelopeAreaBasis | null = area === null ? null : "declared_land";
  if (parcel.candidate?.landAreaM2 != null) {
    if (parcel.status === "matched") {
      area = parcel.candidate.landAreaM2;
      basis = "parcel";
    } else if (parcel.status === "area_unverified") {
      area = parcel.candidate.landAreaM2;
      basis = "parcel_unverified";
    }
  }
  return buildableEnvelope({
    landAreaM2: area,
    areaBasis: basis,
    parameters: zoning.confidence === "unknown" ? null : zoning.parameters,
  });
}

/** «1101010409014065» → «11-01-01-04-09-014-065», como la lee Catastro. */
export function formatNomenclature(nomenclature: string): string {
  if (!/^\d{16}$/u.test(nomenclature)) return nomenclature;
  const parts = [2, 2, 2, 2, 2, 3, 3];
  let offset = 0;
  return parts
    .map((length) => {
      const part = nomenclature.slice(offset, offset + length);
      offset += length;
      return part;
    })
    .join("-");
}

/** FOS como porcentaje para leer («0.7» → «70 %»). */
export function formatFos(fos: string): string {
  const percent = Number(fos) * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)} %`;
}
