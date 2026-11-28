import { z } from "zod";

/**
 * Geometría plana sobre WGS84 para ubicar un punto en Córdoba Capital
 * (`point-in-polygon-1.0.0`, ADR 0089, Decisión 6). Trabaja en `number`: son
 * coordenadas y metros para decidir en qué polígono cae un punto, nunca un
 * monto. A esta escala —una ciudad de 25 km— la proyección equirectangular
 * local se aleja de la geodésica por menos de un metro cada kilómetro.
 *
 * Un polígono es un anillo exterior y sus huecos; los anillos van como los
 * publica GeoJSON, `[lon, lat]`, cerrados (el último punto repite el primero).
 * La regla par-impar cuenta un punto sobre el borde de un lado o del otro según
 * cómo caiga la aritmética: por eso las decisiones que dependen de un borde
 * miran además qué hay a pocos metros (`polygonsNear`).
 */
export const POINT_IN_POLYGON_VERSION = "point-in-polygon-1.0.0";

export type LonLat = readonly [number, number];
export type Ring = readonly LonLat[];
export type Polygon = readonly Ring[];
export type MultiPolygon = readonly Polygon[];

export type GeoPoint = {
  readonly latitude: number;
  readonly longitude: number;
};

export type BoundingBox = {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
};

const lonLatSchema = z
  .tuple([z.number().finite(), z.number().finite()])
  .refine(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90, {
    message: "coordinate_out_of_range",
  });

const ringSchema = z
  .array(lonLatSchema)
  .min(4)
  .refine(
    (ring) =>
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1],
    { message: "ring_not_closed" },
  );

/** Un multipolígono validado: anillos cerrados, coordenadas en rango. */
export const multiPolygonSchema = z.array(z.array(ringSchema).min(1)).min(1);

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 110_574;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distancia del gran círculo, en metros. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function boundingBoxOf(geometry: MultiPolygon): BoundingBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of geometry)
    for (const [lon, lat] of polygon[0]) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  return { minLon, minLat, maxLon, maxLat };
}

function insideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function polygonContains(polygon: Polygon, point: GeoPoint): boolean {
  const { longitude: lon, latitude: lat } = point;
  if (!insideRing(lon, lat, polygon[0])) return false;
  for (let hole = 1; hole < polygon.length; hole += 1)
    if (insideRing(lon, lat, polygon[hole])) return false;
  return true;
}

export function multiPolygonContains(
  geometry: MultiPolygon,
  point: GeoPoint,
): boolean {
  return geometry.some((polygon) => polygonContains(polygon, point));
}

/**
 * Distancia en metros del punto al borde más cercano del multipolígono, o 0 si
 * el punto está adentro.
 */
export function distanceToMultiPolygonMeters(
  geometry: MultiPolygon,
  point: GeoPoint,
): number {
  if (multiPolygonContains(geometry, point)) return 0;
  const kx = METERS_PER_DEGREE_LAT * Math.cos(radians(point.latitude));
  const ky = METERS_PER_DEGREE_LAT;
  const px = point.longitude * kx;
  const py = point.latitude * ky;
  let best = Infinity;
  for (const polygon of geometry)
    for (const ring of polygon)
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const ax = ring[i][0] * kx;
        const ay = ring[i][1] * ky;
        const dx = ring[i + 1][0] * kx - ax;
        const dy = ring[i + 1][1] * ky - ay;
        const length = dx * dx + dy * dy;
        const t =
          length === 0
            ? 0
            : Math.max(
                0,
                Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length),
              );
        const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (distance < best) best = distance;
      }
  return best;
}

/** Si el punto puede estar a `meters` o menos de la caja (prefiltro barato). */
export function boxWithin(
  box: BoundingBox,
  point: GeoPoint,
  meters: number,
): boolean {
  const dLat = meters / METERS_PER_DEGREE_LAT;
  const dLon =
    meters / (METERS_PER_DEGREE_LAT * Math.cos(radians(point.latitude)));
  return (
    point.longitude >= box.minLon - dLon &&
    point.longitude <= box.maxLon + dLon &&
    point.latitude >= box.minLat - dLat &&
    point.latitude <= box.maxLat + dLat
  );
}

export type LayerFeature<P> = {
  readonly key: string;
  readonly box: BoundingBox;
  readonly geometry: MultiPolygon;
  readonly properties: P;
};

/** Los polígonos que contienen el punto. */
export function polygonsAt<P>(
  features: readonly LayerFeature<P>[],
  point: GeoPoint,
): LayerFeature<P>[] {
  return features.filter(
    (feature) =>
      boxWithin(feature.box, point, 0) &&
      multiPolygonContains(feature.geometry, point),
  );
}

/** Los polígonos que contienen el punto o están a `meters` o menos. */
export function polygonsNear<P>(
  features: readonly LayerFeature<P>[],
  point: GeoPoint,
  meters: number,
): LayerFeature<P>[] {
  return features.filter(
    (feature) =>
      boxWithin(feature.box, point, meters) &&
      distanceToMultiPolygonMeters(feature.geometry, point) <= meters,
  );
}
