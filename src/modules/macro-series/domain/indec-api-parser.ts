import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  parseJsonPreservingNumbers,
} from "@/modules/fundamentals/domain/exact-json";
import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import {
  indecConventionalSignSchema,
  type ArgentinaIndicator,
  type IndecConventionalSign,
} from "./argentina-indicator";

export const INDEC_API_PARSER_VERSION = "indec-api-1.2.0";
export const INDEC_API_BASE_URL = "https://api.indec.gob.ar/v1/";
/** The API returns at most 1,000 rows, whatever `limit` asks (Catálogo API-INDEC). */
export const INDEC_PAGE_LIMIT = 1000;
export const INDEC_MAX_PAGES = 10;
const decimal = createDecimalOperations((code) => new Error(code));

/**
 * What the project knows about one INDEC data service: its exact column set,
 * the full key that makes pagination stable, and where period and value live.
 * A service the API reshapes stops parsing by name instead of shifting columns.
 */
export type IndecServiceProfile = {
  readonly columns: readonly string[];
  readonly order: string;
  readonly year: string;
  readonly month: string;
  readonly period: string;
  readonly value: string;
  readonly valueNull: string;
  readonly note: string | null;
};

export const INDEC_SERVICES: Readonly<Record<string, IndecServiceProfile>> = {
  "estimador-mensual-de-actividad-economica-nivel-general": {
    columns: [
      "tipo_de_indicador_descripcion",
      "anio",
      "mes",
      "periodo",
      "tipo_de_indicador",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order: "tipo_de_indicador_descripcion,anio,mes,periodo,tipo_de_indicador",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  "estimador-mensual-de-actividad-economica-sectores": {
    columns: [
      "anio",
      "mes",
      "codigo",
      "descripcion",
      "periodo",
      "tipo_de_indicador",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order: "anio,mes,codigo,descripcion,periodo,tipo_de_indicador",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  ipc_nacional: {
    columns: [
      "clasificador",
      "nivel",
      "codigo",
      "descripcion",
      "periodo",
      "anio",
      "mes",
      "indicador",
      "tipo_de_indicador",
      "tipo_de_indicador_descripcion",
      "region",
      "unidad_de_medida",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order: "anio,mes,periodo,region,nivel,codigo,tipo_de_indicador",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  valorizacion_canastas_cba_cbt: {
    columns: [
      "clasificador",
      "nivel",
      "codigo",
      "descripcion",
      "periodo",
      "anio",
      "mes",
      "indicador",
      "tipo_de_indicador",
      "tipo_de_indicador_descripcion",
      "region",
      "unidad_de_medida",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order: "anio,mes,periodo,codigo,tipo_de_indicador",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  ipi_manufacturero: {
    columns: [
      "periodo",
      "anio",
      "mes",
      "indicador",
      "cuadro_web",
      "codigo_CLaNAE_2004",
      "descripcion",
      "serie",
      "tipo_de_indicador",
      "unidad_de_medida",
      "valor",
      "valor_null",
    ],
    order:
      "periodo,indicador,cuadro_web,codigo_CLaNAE_2004,descripcion,serie,tipo_de_indicador",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: null,
  },
  ipi_minero: {
    columns: [
      "periodo",
      "anio",
      "mes",
      "indicador",
      "cuadro_web",
      "codigo_ClaNAE_2010",
      "codigo_CPC_2_1",
      "serie",
      "descripcion",
      "tipo_de_indicador",
      "unidad_de_medida",
      "valor",
      "valor_null",
    ],
    order:
      "periodo,indicador,cuadro_web,codigo_ClaNAE_2010,codigo_CPC_2_1,serie,descripcion,tipo_de_indicador,unidad_de_medida",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: null,
  },
  sipm_precios_mayoristas: {
    columns: [
      "operativo",
      "indicador",
      "clasificador",
      "nivel",
      "codigo_apertura",
      "descripcion",
      "periodo",
      "anio",
      "mes",
      "tipo_de_indicador",
      "tipo_de_indicador_descripcion",
      "region",
      "unidad_de_medida",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order:
      "periodo,operativo,indicador,clasificador,nivel,codigo_apertura,descripcion,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  icc_precios_construccion: {
    columns: [
      "indicador",
      "codigo_apertura",
      "codigo_CPC_1",
      "clasificador",
      "nivel",
      "descripcion",
      "periodo",
      "anio",
      "mes",
      "tipo_de_indicador",
      "tipo_de_indicador_descripcion",
      "region",
      "unidad_de_medida",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order:
      "periodo,indicador,codigo_apertura,codigo_CPC_1,clasificador,nivel,descripcion,tipo_de_indicador,tipo_de_indicador_descripcion,region,unidad_de_medida",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
  indice_salarios: {
    columns: [
      "clasificador",
      "nivel",
      "codigo",
      "descripcion",
      "periodo",
      "anio",
      "mes",
      "indicador",
      "tipo_de_indicador",
      "tipo_de_indicador_descripcion",
      "unidad_de_medida",
      "valor",
      "valor_null",
      "observaciones",
    ],
    order:
      "periodo,clasificador,nivel,codigo,descripcion,indicador,tipo_de_indicador,tipo_de_indicador_descripcion,unidad_de_medida",
    year: "anio",
    month: "mes",
    period: "periodo",
    value: "valor",
    valueNull: "valor_null",
    note: "observaciones",
  },
};

export type IndecPoint = {
  readonly periodOn: string;
  readonly value: string | null;
  readonly note: IndecConventionalSign | null;
};

export type IndecParseFailure =
  | "invalid_json"
  | "api_error"
  | "schema_changed"
  | "filter_mismatch"
  | "period_mismatch"
  | "invalid_value"
  | "unknown_note"
  | "duplicate_period"
  | "page_limit";

export type IndecParseResult =
  | { readonly ok: true; readonly points: readonly IndecPoint[] }
  | { readonly ok: false; readonly reason: IndecParseFailure };

export function indecServiceOf(
  indicator: ArgentinaIndicator,
): IndecServiceProfile {
  const service = INDEC_SERVICES[indicator.externalId];
  if (!service)
    throw new Error(`indec_service_not_declared: ${indicator.externalId}`);
  for (const column of Object.keys(indicator.filters)) {
    if (!service.columns.includes(column)) {
      throw new Error(`indec_filter_not_a_column: ${column}`);
    }
  }
  return service;
}

/** One page of a declared series: its filters, the full key order and a window. */
export function indecPageUrl(
  indicator: ArgentinaIndicator,
  offset: number,
): string {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("invalid_indec_offset");
  }
  const service = indecServiceOf(indicator);
  // Percent-encoded by hand: a form-encoded `+` is not a space to PostgREST.
  const params = [
    ...Object.entries(indicator.filters).map(
      ([column, value]) => [column, `eq.${value}`] as const,
    ),
    ["order", service.order] as const,
    ["limit", String(INDEC_PAGE_LIMIT)] as const,
    ["offset", String(offset)] as const,
  ]
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replaceAll("%2C", ",")}`,
    )
    .join("&");
  return `${INDEC_API_BASE_URL}${indicator.externalId}?${params}`;
}

function integerOf(value: unknown): number | null {
  if (!(value instanceof ExactJsonNumber)) return null;
  const parsed = Number(value.source);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function signOf(value: unknown): IndecConventionalSign | null | undefined {
  if (value === null) return null;
  const sign = indecConventionalSignSchema.safeParse(value);
  return sign.success ? sign.data : undefined;
}

function noteOf(
  value: unknown,
  indicator: ArgentinaIndicator,
): IndecConventionalSign | null | undefined {
  if (
    (indicator.externalId === "sipm_precios_mayoristas" ||
      indicator.externalId === "icc_precios_construccion") &&
    value === "* Dato provisorio"
  ) {
    return "*";
  }
  return signOf(value);
}

/**
 * Reads one page of a declared INDEC series. Every row must carry exactly the
 * service's columns and the indicator's filter values; a missing value needs a
 * conventional sign, and a note must be one of those signs.
 */
export function parseIndecPage(
  text: string,
  indicator: ArgentinaIndicator,
): IndecParseResult {
  const service = indecServiceOf(indicator);
  let parsed: unknown;
  try {
    parsed = parseJsonPreservingNumbers(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      reason:
        parsed !== null && typeof parsed === "object" && "code" in parsed
          ? "api_error"
          : "schema_changed",
    };
  }
  if (parsed.length > INDEC_PAGE_LIMIT)
    return { ok: false, reason: "page_limit" };

  const expected = [...service.columns].sort().join("\u0000");
  const points: IndecPoint[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "schema_changed" };
    }
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).sort().join("\u0000") !== expected) {
      return { ok: false, reason: "schema_changed" };
    }
    for (const [column, value] of Object.entries(indicator.filters)) {
      if (row[column] !== value)
        return { ok: false, reason: "filter_mismatch" };
    }

    const year = integerOf(row[service.year]);
    const month = integerOf(row[service.month]);
    const period = row[service.period];
    if (
      year === null ||
      month === null ||
      month < 1 ||
      month > 12 ||
      typeof period !== "string" ||
      period !== `${year}${String(month).padStart(2, "0")}`
    ) {
      return { ok: false, reason: "period_mismatch" };
    }
    const periodOn = `${period.slice(0, 4)}-${period.slice(4)}-01`;
    if (seen.has(periodOn)) return { ok: false, reason: "duplicate_period" };
    seen.add(periodOn);

    const nullSign = signOf(row[service.valueNull]);
    const note =
      service.note === null ? null : noteOf(row[service.note], indicator);
    if (nullSign === undefined || note === undefined) {
      return { ok: false, reason: "unknown_note" };
    }
    const rawValue = row[service.value];
    if (rawValue === null) {
      if (nullSign === null || (note !== null && note !== nullSign)) {
        return { ok: false, reason: "invalid_value" };
      }
      points.push({ periodOn, value: null, note: nullSign });
      continue;
    }
    const value =
      rawValue instanceof ExactJsonNumber
        ? canonicalDecimalFromJsonNumber(rawValue.source)
        : null;
    if (value === null || nullSign !== null) {
      return { ok: false, reason: "invalid_value" };
    }
    // IPC levels and basket costs are strictly positive across the whole
    // history. Checking only the last two months at reconciliation would let
    // a corrupt older level become a published observation.
    if (
      [
        "ipc_nacional",
        "valorizacion_canastas_cba_cbt",
        "ipi_manufacturero",
        "ipi_minero",
        "sipm_precios_mayoristas",
        "icc_precios_construccion",
        "indice_salarios",
      ].includes(indicator.externalId) &&
      indicator.filters.tipo_de_indicador !== "v_m" &&
      indicator.filters.tipo_de_indicador !== "Variación intermensual"
    ) {
      try {
        if (decimal.parseDecimal(value, "indec_level").lte(0)) {
          return { ok: false, reason: "invalid_value" };
        }
      } catch {
        return { ok: false, reason: "invalid_value" };
      }
    }
    points.push({ periodOn, value, note });
  }
  return {
    ok: true,
    points: points.sort((a, b) => a.periodOn.localeCompare(b.periodOn)),
  };
}
