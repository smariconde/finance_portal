import { z } from "zod";

import {
  polygonsAt,
  polygonsNear,
  type GeoPoint,
  type LayerFeature,
} from "./geo-geometry";
import type { ZoningFeatureProperties } from "./idecor-wfs";

/**
 * Qué se puede construir en un punto según la ordenanza
 * (`zoning-resolution-1.0.0`, ADR 0089, Decisión 7). La zonificación nunca es
 * verdad: es una lectura fechada con su confianza.
 *
 * - `official_query`: el owner consultó al municipio por esa parcela
 *   (`pnpm inmuebles:zoning-query`). Es el único documento oficial.
 * - `official_map`: un punto que ubica la parcela —dirección con número o pin
 *   propio— cae en exactamente un polígono de la 8256 de IDECOR.
 * - `corridor_inferred`: la zona sale del entorno, no de la parcela. Un punto
 *   de cuadra (Georef sobre el eje de la calle, que suele ser el límite entre
 *   dos zonas) o un pin en una calle, cuando todos los polígonos a 25 m son de
 *   la misma zona. Medido el 2026-11-28 sobre 225 cuadras: en 153 hay una sola
 *   zona a 25 m y en el 86 % es la del pin; las otras 72 son ambiguas.
 * - `unknown`: sin punto, con un pin compartido (el centro de un barrio o de un
 *   country), con varias zonas cerca o fuera de la capa. Nunca se completa con
 *   el promedio del barrio; si hay candidatas, se nombran.
 *
 * La capa publica FOS en porcentaje y FOT como factor. Un cero es «no
 * publicado», no «no edificable»: los convenios urbanísticos lo traen en cero
 * y alguno trae las columnas cruzadas (FOS 2, FOT 0,4), así que un convenio
 * (Ord. 12077) no aporta parámetros. Los pisos se leen como los publica la
 * capa («Planta Baja + 7 pisos» son 8 plantas).
 */
export const ZONING_RESOLUTION_VERSION = "zoning-resolution-1.0.0";
export const ZONING_ORDINANCE = "Ord. 8256/86 y modificatorias (IDECOR)";
/** El radio del entorno de un punto de cuadra o de calle. */
export const ZONING_NEIGHBORHOOD_M = 25;

export const ZONING_CONFIDENCES = [
  "official_query",
  "official_map",
  "corridor_inferred",
  "unknown",
] as const;
export type ZoningConfidence = (typeof ZONING_CONFIDENCES)[number];

export type ZoningParameters = {
  /** FOS como fracción, en decimal canónico («0.7»). */
  readonly fos: string | null;
  readonly fot: string | null;
  readonly heightMaxM: string | null;
  /** Plantas totales, planta baja incluida. */
  readonly floorsMax: number | null;
};

export type ZoningMissing =
  | "fos_not_published"
  | "fot_not_published"
  | "height_not_published"
  | "floors_not_published"
  | "special_agreement";

export type ZoningReading =
  | {
      readonly confidence: Exclude<ZoningConfidence, "unknown">;
      /** El código del patrón o perfil, como lo publica la norma («8256-G1»). */
      readonly pattern: string;
      readonly zone: string | null;
      readonly character: string | null;
      readonly ordinance: string;
      readonly parameters: ZoningParameters;
      readonly missing: readonly ZoningMissing[];
      /** La consulta o el polígono de la capa. */
      readonly evidence: string;
      readonly observedAt: string;
    }
  | {
      readonly confidence: "unknown";
      readonly reason:
        | "no_location"
        | "shared_pin"
        | "outside_layer"
        | "several_zones"
        | "layer_unavailable";
      /** Los patrones cercanos cuando hay más de uno. */
      readonly candidates: readonly string[];
    };

const canonicalDecimal = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;

const zoningParametersSchema = z.strictObject({
  fos: z.string().regex(canonicalDecimal).nullable(),
  fot: z.string().regex(canonicalDecimal).nullable(),
  heightMaxM: z.string().regex(canonicalDecimal).nullable(),
  floorsMax: z.number().int().min(1).max(80).nullable(),
});

export const zoningReadingSchema: z.ZodType<ZoningReading> = z.union([
  z.strictObject({
    confidence: z.enum(["official_query", "official_map", "corridor_inferred"]),
    pattern: z.string().min(1).max(80),
    zone: z.string().max(80).nullable(),
    character: z.string().max(600).nullable(),
    ordinance: z.string().min(1).max(200),
    parameters: zoningParametersSchema,
    missing: z.array(
      z.enum([
        "fos_not_published",
        "fot_not_published",
        "height_not_published",
        "floors_not_published",
        "special_agreement",
      ]),
    ),
    evidence: z.string().min(1).max(300),
    observedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    confidence: z.literal("unknown"),
    reason: z.enum([
      "no_location",
      "shared_pin",
      "outside_layer",
      "several_zones",
      "layer_unavailable",
    ]),
    candidates: z.array(z.string().min(1).max(80)).max(10),
  }),
]);

/** Un número de la capa en decimal canónico; cero o negativo es «no publicado». */
function positive(value: string | number | null, divisor = 1): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  // La división por 100 de un porcentaje entero es exacta en decimal.
  const text =
    divisor === 1
      ? String(value)
      : (() => {
          if (!Number.isInteger(value)) return String(value / divisor);
          const padded = String(value).padStart(3, "0");
          return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
        })();
  const trimmed = text.includes(".")
    ? text.replace(/0+$/u, "").replace(/\.$/u, "")
    : text;
  const canonical = trimmed.replace(/^0+(?=\d)/u, "");
  return canonicalDecimal.test(canonical) ? canonical : null;
}

/** «Planta Baja + 7 pisos» → 8; «PB + 4 pisos (…)» → 5; sin dato → null. */
export function floorsFromText(text: string | number | null): number | null {
  if (typeof text !== "string") return null;
  const match =
    /^(?:planta baja|pb)\s*\+\s*(\d{1,2})\s*(?:pisos?|plantas?)\b/iu.exec(
      text.trim(),
    );
  return match === null ? null : Number(match[1]) + 1;
}

const textOf = (value: string | number | null) =>
  typeof value === "string" ? value : null;

/** Los parámetros de un polígono, con lo que no publica nombrado. */
export function zoningParametersOf(properties: ZoningFeatureProperties): {
  readonly parameters: ZoningParameters;
  readonly missing: ZoningMissing[];
} {
  const pattern = textOf(properties.ord_y_perfil) ?? "";
  if (/convenio urban/iu.test(pattern))
    return {
      parameters: { fos: null, fot: null, heightMaxM: null, floorsMax: null },
      missing: ["special_agreement"],
    };
  const fosPercent = properties.fos;
  const fos =
    typeof fosPercent === "number" && fosPercent > 0 && fosPercent <= 100
      ? positive(fosPercent, 100)
      : null;
  const parameters: ZoningParameters = {
    fos,
    fot: positive(properties.fot),
    heightMaxM: positive(properties.altura_maxima),
    floorsMax: floorsFromText(properties.pisos_maximos),
  };
  const missing: ZoningMissing[] = [];
  if (parameters.fos === null) missing.push("fos_not_published");
  if (parameters.fot === null) missing.push("fot_not_published");
  if (parameters.heightMaxM === null) missing.push("height_not_published");
  if (parameters.floorsMax === null) missing.push("floors_not_published");
  return { parameters, missing };
}

/** La consulta del owner al municipio, por nomenclatura provincial. */
export type ZoningQuery = {
  readonly nomenclature: string;
  readonly pattern: string;
  readonly ordinance: string;
  readonly fos: string | null;
  readonly fot: string | null;
  readonly heightMaxM: string | null;
  readonly floorsMax: number | null;
  /** El día de la respuesta del municipio. */
  readonly consultedOn: string;
  /** Expediente, nota o certificado, como lo identifique el owner. */
  readonly reference: string;
  readonly declaredAt: string;
};

export type ZoningLocationBasis =
  | "address_geocoded"
  | "portal_pin"
  | "address_block"
  | "portal_pin_shared"
  | "none";

export function resolveZoning(input: {
  readonly basis: ZoningLocationBasis;
  readonly point: GeoPoint | null;
  /** La parcela afirmada, si la hay. */
  readonly nomenclature: string | null;
  readonly query: ZoningQuery | null;
  readonly layer: {
    readonly features: readonly LayerFeature<ZoningFeatureProperties>[];
    readonly observedAt: string;
  } | null;
}): ZoningReading {
  if (input.query !== null && input.query.nomenclature === input.nomenclature) {
    const { query } = input;
    const parameters: ZoningParameters = {
      fos: query.fos,
      fot: query.fot,
      heightMaxM: query.heightMaxM,
      floorsMax: query.floorsMax,
    };
    const missing: ZoningMissing[] = [];
    if (parameters.fos === null) missing.push("fos_not_published");
    if (parameters.fot === null) missing.push("fot_not_published");
    if (parameters.heightMaxM === null) missing.push("height_not_published");
    if (parameters.floorsMax === null) missing.push("floors_not_published");
    return {
      confidence: "official_query",
      pattern: query.pattern,
      zone: null,
      character: null,
      ordinance: query.ordinance,
      parameters,
      missing,
      evidence: query.reference,
      observedAt: query.declaredAt,
    };
  }
  if (input.point === null || input.basis === "none")
    return { confidence: "unknown", reason: "no_location", candidates: [] };
  if (input.basis === "portal_pin_shared")
    return { confidence: "unknown", reason: "shared_pin", candidates: [] };
  if (input.layer === null)
    return {
      confidence: "unknown",
      reason: "layer_unavailable",
      candidates: [],
    };

  const { features, observedAt } = input.layer;
  const inside = polygonsAt(features, input.point);
  const decisive =
    input.basis === "address_geocoded" || input.basis === "portal_pin";
  let chosen: LayerFeature<ZoningFeatureProperties> | null = null;
  let confidence: "official_map" | "corridor_inferred" = "official_map";

  if (decisive && inside.length === 1) chosen = inside[0];
  else {
    const near = polygonsNear(features, input.point, ZONING_NEIGHBORHOOD_M);
    const patterns = [
      ...new Set(near.map((feature) => patternOf(feature.properties))),
    ].sort();
    if (patterns.length === 0)
      return { confidence: "unknown", reason: "outside_layer", candidates: [] };
    if (patterns.length > 1)
      return {
        confidence: "unknown",
        reason: "several_zones",
        candidates: patterns.slice(0, 10),
      };
    // Una sola zona alrededor: el polígono que contiene el punto, o el más
    // cercano de esa zona.
    chosen = inside[0] ?? near[0];
    confidence = "corridor_inferred";
  }

  const { parameters, missing } = zoningParametersOf(chosen.properties);
  const ordinance = [
    textOf(chosen.properties.ord_original),
    textOf(chosen.properties.ord_modificatoria),
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
  return {
    confidence,
    pattern: patternOf(chosen.properties),
    zone: textOf(chosen.properties.zona),
    character: textOf(chosen.properties.caracter_urbanistico),
    ordinance: ordinance === "" ? ZONING_ORDINANCE : ordinance.slice(0, 200),
    parameters,
    missing,
    evidence: `IDECOR ${chosen.key}`,
    observedAt,
  };
}

function patternOf(properties: ZoningFeatureProperties): string {
  return (textOf(properties.ord_y_perfil) ?? "sin patrón").slice(0, 80);
}
