import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import type { BarrioProperties } from "./cordoba-barrios";
import { polygonsAt, type LayerFeature } from "./geo-geometry";
import { georefResultSchema, type GeorefResult } from "./georef-addresses";
import {
  parcelAtPointSchema,
  type ParcelAtPoint,
  type ZoningFeatureProperties,
} from "./idecor-wfs";
import type { PropertyType } from "./listing-capture";
import {
  fixLocation,
  LOCATION_PRECISIONS,
  locatesParcel,
  type LocationInput,
  type LocationPrecision,
} from "./location-precision";
import {
  resolveZoning,
  zoningReadingSchema,
  type ZoningQuery,
  type ZoningReading,
} from "./zoning-resolution";

/**
 * Dónde está un aviso y qué admite su suelo (`listing-location-1.0.0`): la
 * precisión, el punto, el barrio, la parcela y la zona, leídos a la vez de la
 * misma revisión del aviso. Se guarda una lectura nueva sólo cuando cambia su
 * entrada —la dirección o el pin, lo que respondió Georef, lo que respondió
 * IDECOR o la release de una capa—, así que releerla nunca gasta un pedido.
 *
 * El barrio y la zona salen del mejor punto que haya, con o sin parcela
 * (decisión del owner: saber «en qué barrio» y «qué FOS» aunque la parcela no
 * se pueda afirmar). La parcela sólo con un punto que la ubica, por
 * `parcel-match-1.0.0`:
 *
 * - una parcela bajo el punto y la superficie del aviso a ±10 % → `matched`;
 * - un departamento, oficina, local o cochera está en un edificio: la parcela
 *   es la del edificio y la superficie no se compara → `building_parcel`;
 * - una casa, PH o terreno sin superficie publicada → `area_unverified`;
 * - superficies que no coinciden → `area_mismatch`: queda como candidata y la
 *   envolvente usa el terreno del aviso. Medido: los cocientes de más de 3
 *   son parcelas madre de countries (hasta 1.577×);
 * - ninguna (el pin cae en la calle: 69 de 364) o varias → sin parcela.
 */
export const LISTING_LOCATION_VERSION = "listing-location-1.0.0";
export const PARCEL_MATCH_VERSION = "parcel-match-1.0.0";
export const PARCEL_AREA_TOLERANCE = 0.1;

const UNIT_IN_BUILDING: ReadonlySet<PropertyType> = new Set([
  "apartment",
  "office",
  "retail",
  "parking",
]);

export const PARCEL_STATUSES = [
  "matched",
  "building_parcel",
  "area_unverified",
  "area_mismatch",
  "no_parcel_at_point",
  "several_parcels",
  "not_located",
  "pending",
] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

/** La parcela se afirma (y se puede vincular a la unidad en `F13-05`). */
export function parcelAffirmed(status: ParcelStatus): boolean {
  return status === "matched" || status === "building_parcel";
}

export type LocationReading = {
  readonly version: typeof LISTING_LOCATION_VERSION;
  readonly listingRevision: number;
  readonly precision: LocationPrecision;
  readonly point: {
    readonly latitude: number;
    readonly longitude: number;
  } | null;
  readonly addressKind: string;
  readonly addressKey: string | null;
  readonly geocode: GeorefResult | null;
  readonly pinAddressDistanceM: number | null;
  readonly pinFarFromAddress: boolean;
  readonly barrio: {
    readonly name: string;
    readonly barrioKey: string;
    readonly official: boolean;
  } | null;
  readonly barrioReason:
    "no_location" | "outside_barrios" | "layer_unavailable" | null;
  readonly parcel: {
    readonly status: ParcelStatus;
    readonly candidate: ParcelAtPoint | null;
  };
  readonly zoning: ZoningReading;
  readonly layers: {
    readonly barrios: string | null;
    readonly zoning: string | null;
  };
};

const pointSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const locationReadingSchema: z.ZodType<LocationReading> = z.strictObject(
  {
    version: z.literal(LISTING_LOCATION_VERSION),
    listingRevision: z.number().int().positive(),
    precision: z.enum(LOCATION_PRECISIONS),
    point: pointSchema.nullable(),
    addressKind: z.string().min(1).max(32),
    addressKey: z.string().min(1).max(300).nullable(),
    geocode: georefResultSchema.nullable(),
    pinAddressDistanceM: z.number().int().min(0).nullable(),
    pinFarFromAddress: z.boolean(),
    barrio: z
      .strictObject({
        name: z.string().min(1).max(160),
        barrioKey: z.string().min(1).max(160),
        official: z.boolean(),
      })
      .nullable(),
    barrioReason: z
      .enum(["no_location", "outside_barrios", "layer_unavailable"])
      .nullable(),
    parcel: z.strictObject({
      status: z.enum(PARCEL_STATUSES),
      candidate: parcelAtPointSchema.nullable(),
    }),
    zoning: zoningReadingSchema,
    layers: z.strictObject({
      barrios: z.uuid().nullable(),
      zoning: z.uuid().nullable(),
    }),
  },
);

export type LayerRelease<P> = {
  readonly releaseId: string;
  readonly observedAt: string;
  readonly features: readonly LayerFeature<P>[];
};

export type LocationListing = LocationInput & {
  readonly revision: number;
  readonly propertyType: PropertyType;
  readonly landAreaM2: string | null;
};

/** La clave de una consulta de parcela: el punto a siete decimales (~1 cm). */
export function pointKey(point: {
  readonly latitude: number;
  readonly longitude: number;
}): string {
  return `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)}`;
}

export function matchParcel(input: {
  readonly propertyType: PropertyType;
  readonly landAreaM2: string | null;
  readonly parcels: readonly ParcelAtPoint[];
}): { status: ParcelStatus; candidate: ParcelAtPoint | null } {
  if (input.parcels.length === 0)
    return { status: "no_parcel_at_point", candidate: null };
  if (input.parcels.length > 1)
    return { status: "several_parcels", candidate: null };
  const [parcel] = input.parcels;
  if (UNIT_IN_BUILDING.has(input.propertyType))
    return { status: "building_parcel", candidate: parcel };
  if (input.landAreaM2 === null || parcel.landAreaM2 === null)
    return { status: "area_unverified", candidate: parcel };
  const declared = Number(input.landAreaM2);
  const measured = Number(parcel.landAreaM2);
  return {
    status:
      Math.abs(measured - declared) <= declared * PARCEL_AREA_TOLERANCE
        ? "matched"
        : "area_mismatch",
    candidate: parcel,
  };
}

/**
 * Lo que una lectura necesita y todavía no se preguntó: la dirección a
 * Georef y el punto a IDECOR. Con una altura exacta pendiente el punto depende
 * de Georef, así que la parcela queda para la vuelta siguiente.
 */
export function pendingLookups(input: {
  readonly listing: LocationListing;
  readonly pinShared: boolean;
  readonly geocode: GeorefResult | null | undefined;
  readonly parcelsAt: (key: string) => readonly ParcelAtPoint[] | undefined;
}): { readonly addressKey: string | null; readonly pointKey: string | null } {
  const fix = fixLocation({
    listing: input.listing,
    pinShared: input.pinShared,
    geocode: input.geocode ?? null,
  });
  const addressKey =
    fix.address.kind === "street_number" && input.geocode === undefined
      ? fix.address.addressKey
      : null;
  // Sólo una altura exacta puede ganarle al pin: con ella pendiente, el punto
  // todavía no se sabe. Una altura redonda ubica la cuadra y el pin manda.
  const waitsForAddress =
    addressKey !== null &&
    fix.address.kind === "street_number" &&
    !fix.address.rounded;
  const point =
    !waitsForAddress &&
    locatesParcel(fix.precision) &&
    fix.point !== null &&
    input.parcelsAt(pointKey(fix.point)) === undefined
      ? pointKey(fix.point)
      : null;
  return { addressKey, pointKey: point };
}

export function resolveListingLocation(input: {
  readonly listing: LocationListing;
  readonly pinShared: boolean;
  /** `undefined`: no se preguntó todavía; `null`: no hay qué preguntar. */
  readonly geocode: GeorefResult | null | undefined;
  readonly parcelsAt: (key: string) => readonly ParcelAtPoint[] | undefined;
  readonly zoningQueryFor: (nomenclature: string) => ZoningQuery | null;
  readonly barrios: LayerRelease<BarrioProperties> | null;
  readonly zoning: LayerRelease<ZoningFeatureProperties> | null;
}): LocationReading {
  const { listing } = input;
  const fix = fixLocation({
    listing,
    pinShared: input.pinShared,
    geocode: input.geocode ?? null,
  });

  let barrio: LocationReading["barrio"] = null;
  let barrioReason: LocationReading["barrioReason"] = null;
  if (fix.point === null) barrioReason = "no_location";
  else if (input.barrios === null) barrioReason = "layer_unavailable";
  else {
    const hits = polygonsAt(input.barrios.features, fix.point);
    const first = hits[0]?.properties;
    if (first === undefined) barrioReason = "outside_barrios";
    else
      barrio = {
        name: first.name,
        barrioKey: first.barrioKey,
        official: first.official,
      };
  }

  let parcel: LocationReading["parcel"];
  if (!locatesParcel(fix.precision) || fix.point === null)
    parcel = { status: "not_located", candidate: null };
  else {
    const parcels = input.parcelsAt(pointKey(fix.point));
    parcel =
      parcels === undefined
        ? { status: "pending", candidate: null }
        : matchParcel({
            propertyType: listing.propertyType,
            landAreaM2: listing.landAreaM2,
            parcels,
          });
  }

  const nomenclature =
    parcel.candidate !== null && parcel.status !== "area_mismatch"
      ? parcel.candidate.nomenclature
      : null;
  const zoning = resolveZoning({
    basis:
      fix.precision === "neighborhood_only" || fix.precision === "unlocated"
        ? "none"
        : fix.precision,
    point: fix.point,
    nomenclature,
    query: nomenclature === null ? null : input.zoningQueryFor(nomenclature),
    layer:
      input.zoning === null
        ? null
        : {
            features: input.zoning.features,
            observedAt: input.zoning.observedAt,
          },
  });

  return locationReadingSchema.parse({
    version: LISTING_LOCATION_VERSION,
    listingRevision: listing.revision,
    precision: fix.precision,
    point: fix.point,
    addressKind: fix.address.kind,
    addressKey:
      fix.address.kind === "street_number" ? fix.address.addressKey : null,
    geocode:
      fix.address.kind === "street_number" ? (input.geocode ?? null) : null,
    pinAddressDistanceM: fix.pinAddressDistanceM,
    pinFarFromAddress: fix.pinFarFromAddress,
    barrio,
    barrioReason,
    parcel,
    zoning,
    layers: {
      barrios: input.barrios?.releaseId ?? null,
      zoning: input.zoning?.releaseId ?? null,
    },
  });
}

/** La lectura sin su revisión: dos revisiones con la misma ubicación no cambian nada. */
export function locationReadingHash(reading: LocationReading): string {
  return computeContentHash({ ...reading, listingRevision: null });
}

/**
 * Lo que una lectura lee, sin las capas cargadas: alcanza con sus releases.
 * Dos avisos con la misma entrada dan la misma lectura; un cambio de precio
 * no la mueve.
 */
export function locationInputHash(input: {
  readonly listing: LocationListing;
  readonly pinShared: boolean;
  readonly geocode: GeorefResult | null | undefined;
  readonly parcelsAt: (key: string) => readonly ParcelAtPoint[] | undefined;
  readonly zoningQueryFor: (nomenclature: string) => ZoningQuery | null;
  readonly barriosRelease: string | null;
  readonly zoningRelease: string | null;
}): string {
  const { listing } = input;
  const fix = fixLocation({
    listing,
    pinShared: input.pinShared,
    geocode: input.geocode ?? null,
  });
  const parcels =
    locatesParcel(fix.precision) && fix.point !== null
      ? (input.parcelsAt(pointKey(fix.point)) ?? "unasked")
      : null;
  const single =
    Array.isArray(parcels) && parcels.length === 1 ? parcels[0] : null;
  return computeContentHash({
    version: LISTING_LOCATION_VERSION,
    listing: {
      addressDeclared: listing.addressDeclared,
      neighborhood: listing.neighborhood,
      latitude: listing.latitude,
      longitude: listing.longitude,
      propertyType: listing.propertyType,
      landAreaM2: listing.landAreaM2,
    },
    pinShared: input.pinShared,
    geocode: input.geocode === undefined ? "unasked" : input.geocode,
    parcels,
    query: single === null ? null : input.zoningQueryFor(single.nomenclature),
    barrios: input.barriosRelease,
    zoning: input.zoningRelease,
  });
}
