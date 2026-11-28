import {
  classifyDeclaredAddress,
  normalizeAddressText,
  type DeclaredAddress,
  type GeorefResult,
} from "./georef-addresses";
import { haversineMeters, type GeoPoint } from "./geo-geometry";

/**
 * Cuánto ubica un aviso (`location-precision-1.0.0`, ADR 0089, Decisión 6, con
 * la decisión del owner del 2026-11-28 sobre la altura redondeada). De más a
 * menos:
 *
 * | Precisión           | El punto es                                        | Parcela |
 * | ------------------- | -------------------------------------------------- | ------- |
 * | `address_geocoded`  | la dirección con altura exacta que Georef resolvió | sí      |
 * | `portal_pin`        | el pin propio del portal                           | sí      |
 * | `address_block`     | la cuadra: altura múltiplo de 100 resuelta         | no      |
 * | `portal_pin_shared` | un pin que otros avisos con otra dirección repiten | no      |
 * | `neighborhood_only` | ninguno: sólo el texto del barrio                  | no      |
 * | `unlocated`         | ninguno                                            | no      |
 *
 * `address_block` es nueva respecto de la ADR: Remax redondea 300 de 364
 * alturas y la parcela del punto geocodificado no coincidió con la del aviso
 * en ninguno de 115 casos medidos; la del pin, en 72 de 141. Un pin repetido
 * con la misma dirección es el mismo edificio y sigue siendo `portal_pin`; con
 * otra dirección es el centro de un country o un barrio (medido: Docta,
 * «Manzana 108», «Colectora RN 20»).
 *
 * Si el pin y la dirección están a más de 150 m se marca. Para una cuadra la
 * distancia incluye el largo de la cuadra (mediana medida: 80 m).
 */
export const LOCATION_PRECISION_VERSION = "location-precision-1.0.0";
export const PIN_ADDRESS_FAR_M = 150;

export const LOCATION_PRECISIONS = [
  "address_geocoded",
  "portal_pin",
  "address_block",
  "portal_pin_shared",
  "neighborhood_only",
  "unlocated",
] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

/** Las precisiones que alcanzan para afirmar una parcela. */
export function locatesParcel(precision: LocationPrecision): boolean {
  return precision === "address_geocoded" || precision === "portal_pin";
}

export type LocationInput = {
  readonly addressDeclared: string | null;
  readonly neighborhood: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
};

export type LocationFix = {
  readonly precision: LocationPrecision;
  readonly point: GeoPoint | null;
  readonly address: DeclaredAddress;
  readonly pin: GeoPoint | null;
  /** Metros entre el pin y lo que Georef resolvió, si están los dos. */
  readonly pinAddressDistanceM: number | null;
  readonly pinFarFromAddress: boolean;
};

export function pinOf(input: LocationInput): GeoPoint | null {
  if (input.latitude === null || input.longitude === null) return null;
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

/** La clave de un pin: sus coordenadas tal como las publicó el portal. */
export function pinKey(input: LocationInput): string | null {
  return input.latitude === null || input.longitude === null
    ? null
    : `${input.latitude},${input.longitude}`;
}

/**
 * Los pines compartidos: los que aparecen en avisos cuyas direcciones
 * normalizadas difieren. Sin dirección cuenta como una dirección más.
 */
export function sharedPins(listings: readonly LocationInput[]): Set<string> {
  const addresses = new Map<string, Set<string>>();
  for (const listing of listings) {
    const key = pinKey(listing);
    if (key === null) continue;
    const address =
      listing.addressDeclared === null
        ? ""
        : normalizeAddressText(listing.addressDeclared);
    const set = addresses.get(key) ?? new Set<string>();
    set.add(address);
    addresses.set(key, set);
  }
  return new Set(
    [...addresses].filter(([, set]) => set.size > 1).map(([key]) => key),
  );
}

export function fixLocation(input: {
  readonly listing: LocationInput;
  readonly pinShared: boolean;
  /** Lo que respondió Georef por esa dirección; `null` si no se preguntó. */
  readonly geocode: GeorefResult | null;
}): LocationFix {
  const address = classifyDeclaredAddress(input.listing.addressDeclared);
  const pin = pinOf(input.listing);
  const geocoded =
    address.kind === "street_number" && input.geocode?.status === "matched"
      ? {
          latitude: input.geocode.latitude,
          longitude: input.geocode.longitude,
        }
      : null;
  const distance =
    pin !== null && geocoded !== null
      ? Math.round(haversineMeters(pin, geocoded))
      : null;

  let precision: LocationPrecision;
  let point: GeoPoint | null;
  if (address.kind === "street_number" && !address.rounded && geocoded) {
    precision = "address_geocoded";
    point = geocoded;
  } else if (pin !== null && !input.pinShared) {
    precision = "portal_pin";
    point = pin;
  } else if (geocoded !== null) {
    precision = "address_block";
    point = geocoded;
  } else if (pin !== null) {
    precision = "portal_pin_shared";
    point = pin;
  } else if (
    input.listing.neighborhood !== null &&
    input.listing.neighborhood.trim() !== ""
  ) {
    precision = "neighborhood_only";
    point = null;
  } else {
    precision = "unlocated";
    point = null;
  }

  return {
    precision,
    point,
    address,
    pin,
    pinAddressDistanceM: distance,
    pinFarFromAddress: distance !== null && distance > PIN_ADDRESS_FAR_M,
  };
}
