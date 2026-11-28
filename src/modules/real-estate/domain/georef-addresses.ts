import { z } from "zod";

/**
 * La dirección que publica un aviso y su normalización por Georef
 * (`/direcciones`, ADR 0089, Decisión 6).
 *
 * `declared-address-1.0.0` decide qué dirección vale la pena preguntar. Medido
 * el 2026-11-28 sobre 364 avisos de Remax en Córdoba Capital: 300 traen la
 * altura redondeada a la centena («Rincón 900»), 50 no traen número y las 14
 * alturas «exactas» eran designaciones de lote y manzana. Georef resolvió 224
 * de las 300 redondas, a una mediana de 80 m del pin; una designación de lote
 * la confundió con una calle («Mza 111» → «MENDOZA 111»). Por eso:
 *
 * - una designación de lote, manzana, kilómetro o «s/n» no se pregunta;
 * - una calle de relleno («Calle Desconocida», «Calle Pública») tampoco;
 * - sin número no se pregunta: Georef devuelve el centro de la calle;
 * - una altura múltiplo de 100 es **la cuadra**, no la casa (decisión del
 *   owner con la tabla medida): ubica la cuadra y el barrio, nunca la parcela.
 *
 * `georef-direcciones-1.0.0` lee la respuesta por lotes y acepta un resultado
 * sólo con la misma altura pedida, en el departamento Capital y con
 * coordenadas dentro de la ciudad.
 */
export const DECLARED_ADDRESS_VERSION = "declared-address-1.0.0";
export const GEOREF_PARSER_VERSION = "georef-direcciones-1.0.0";
export const GEOREF_DATASET = "georef.direcciones";
export const GEOREF_ADDRESSES_URL =
  "https://apis.datos.gob.ar/georef/api/direcciones";
/** Georef admite hasta 1.000 consultas por pedido y 5.000 resultados. */
export const GEOREF_MAX_BATCH = 1000;

/** Provincia de Córdoba y departamento Capital en la nomenclatura del INDEC. */
export const GEOREF_PROVINCE_ID = "14";
export const GEOREF_DEPARTMENT_ID = "14014";

/** Caja de Córdoba Capital con margen: un resultado afuera es otro lugar. */
const CAPITAL_BOX = {
  minLat: -31.66,
  maxLat: -31.24,
  minLon: -64.42,
  maxLon: -63.98,
};

export type DeclaredAddress =
  | {
      readonly kind: "street_number";
      readonly street: string;
      readonly number: number;
      /** Múltiplo de 100: la cuadra, no la casa. */
      readonly rounded: boolean;
      /** La clave por la que se guarda y se reusa la respuesta de Georef. */
      readonly addressKey: string;
    }
  | {
      readonly kind:
        | "missing"
        | "no_number"
        | "lot_designation"
        | "placeholder_street"
        | "several_numbers";
    };

const LOT_DESIGNATION =
  /(?:^|[\s,.])(?:manzana|mzna|mza|mz|lote|lte|lt|km|s\/n|s\/ ?numero|sin numero|bloque|depto)(?:$|[\s,.\d])/u;
const PLACEHOLDER_STREET = /\bcalle (?:desconocida|publica)\b/u;

/** Minúsculas, sin tildes ni signos, espacios simples. */
export function normalizeAddressText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyDeclaredAddress(
  declared: string | null,
): DeclaredAddress {
  if (declared === null || declared.trim() === "") return { kind: "missing" };
  const normalized = normalizeAddressText(declared);
  if (LOT_DESIGNATION.test(normalized)) return { kind: "lot_designation" };
  if (PLACEHOLDER_STREET.test(normalized))
    return { kind: "placeholder_street" };
  if (/\s\d{1,5}\s\d{1,5}$/u.test(normalized))
    return { kind: "several_numbers" };
  const match = /^(.*\D)\s(\d{1,5})$/u.exec(normalized);
  if (match === null) return { kind: "no_number" };
  const street = match[1].trim();
  const number = Number(match[2]);
  if (number === 0 || street.length < 2) return { kind: "no_number" };
  return {
    kind: "street_number",
    street,
    number,
    rounded: number % 100 === 0,
    addressKey: `${street} ${number}`,
  };
}

export type GeorefQuery = {
  readonly addressKey: string;
  readonly street: string;
  readonly number: number;
};

/** El cuerpo de un `POST /direcciones` por lotes. */
export function georefBatchBody(queries: readonly GeorefQuery[]): string {
  if (queries.length === 0 || queries.length > GEOREF_MAX_BATCH)
    throw new Error("georef_batch_size");
  return JSON.stringify({
    direcciones: queries.map((query) => ({
      direccion: `${query.street} ${query.number}`,
      provincia: GEOREF_PROVINCE_ID,
      departamento: GEOREF_DEPARTMENT_ID,
      max: 1,
      aplanar: true,
    })),
  });
}

export type GeorefResult =
  | {
      readonly status: "matched";
      readonly streetName: string;
      readonly streetId: string;
      readonly number: number;
      readonly latitude: number;
      readonly longitude: number;
    }
  | {
      readonly status:
        | "not_found"
        | "number_not_matched"
        | "outside_capital"
        | "no_coordinates";
    };

export const georefResultSchema: z.ZodType<GeorefResult> = z.union([
  z.strictObject({
    status: z.literal("matched"),
    streetName: z.string().min(1).max(160),
    streetId: z.string().regex(/^\d{1,20}$/u),
    number: z.number().int().positive(),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
  }),
  z.strictObject({
    status: z.enum([
      "not_found",
      "number_not_matched",
      "outside_capital",
      "no_coordinates",
    ]),
  }),
]);

const flatAddressSchema = z.looseObject({
  altura_valor: z.number().int().nullable(),
  calle_id: z.string().nullable(),
  calle_nombre: z.string().nullable(),
  departamento_id: z.string().nullable(),
  ubicacion_lat: z.number().nullable(),
  ubicacion_lon: z.number().nullable(),
});

const resultSchema = z.looseObject({
  cantidad: z.number().int().min(0),
  direcciones: z.array(flatAddressSchema),
});

const bodySchema = z.looseObject({ resultados: z.array(resultSchema) });

export class GeorefParseError extends Error {
  constructor(readonly code: "georef_body_invalid" | "georef_result_count") {
    super(code);
    this.name = "GeorefParseError";
  }
}

/** Lee la respuesta de un lote: un resultado por consulta, en orden. */
export function parseGeorefBatch(
  text: string,
  queries: readonly GeorefQuery[],
): GeorefResult[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeorefParseError("georef_body_invalid");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new GeorefParseError("georef_body_invalid");
  const results = parsed.data.resultados;
  if (results.length !== queries.length)
    throw new GeorefParseError("georef_result_count");

  return results.map((result, index): GeorefResult => {
    const found = result.direcciones[0];
    if (result.cantidad === 0 || found === undefined)
      return { status: "not_found" };
    if (found.departamento_id !== GEOREF_DEPARTMENT_ID)
      return { status: "outside_capital" };
    if (found.altura_valor !== queries[index].number)
      return { status: "number_not_matched" };
    const lat = found.ubicacion_lat;
    const lon = found.ubicacion_lon;
    if (lat === null || lon === null || !Number.isFinite(lat + lon))
      return { status: "no_coordinates" };
    if (
      lat < CAPITAL_BOX.minLat ||
      lat > CAPITAL_BOX.maxLat ||
      lon < CAPITAL_BOX.minLon ||
      lon > CAPITAL_BOX.maxLon
    )
      return { status: "outside_capital" };
    if (found.calle_nombre === null || found.calle_id === null)
      return { status: "not_found" };
    return {
      status: "matched",
      streetName: found.calle_nombre,
      streetId: found.calle_id,
      number: found.altura_valor,
      latitude: lat,
      longitude: lon,
    };
  });
}
