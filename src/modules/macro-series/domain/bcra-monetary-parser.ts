import { z } from "zod";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  parseJsonWithExactNumbers,
} from "@/modules/fundamentals/domain/exact-json";

import {
  CATALOG_PAGE_LIMIT,
  isBcraVariableId,
  METHODOLOGY_PAGE_LIMIT,
  SERIES_PAGE_LIMIT,
  type BcraVariableId,
} from "./bcra-monetary-source";

/**
 * Parser de Estadísticas Monetarias v4 (`bcra-monetarias-v4-1.0.0`, ADR 0065,
 * decisión 6). Lee contra el cable medido el 2026-11-02, no contra el manual.
 *
 * Dos niveles de rechazo:
 *
 * - la **página**: el sobre o el juego de claves de una fila cambió, la
 *   paginación no cierra o el orden se rompió. Nada de la página se usa;
 * - la **fila**: un campo con un vocabulario o un formato desconocido. Se
 *   nombra la fila y el campo, nunca el valor recibido (`TM-02`), y el resto de
 *   la página sigue.
 */
export const SERIES_FREQUENCIES = ["daily", "monthly", "quarterly"] as const;
export type SeriesFrequency = (typeof SERIES_FREQUENCIES)[number];

/** Códigos de moneda del BCRA: no son ISO, y el manual lo aclara. */
export const BCRA_CURRENCY_CODES = ["ML", "ME", "MEyML", "ARS", "USD"] as const;
export type BcraCurrencyCode = (typeof BCRA_CURRENCY_CODES)[number];

const FREQUENCY_BY_CODE: Readonly<Record<string, SeriesFrequency>> = {
  D: "daily",
  M: "monthly",
  T: "quarterly",
  Q: "quarterly",
};

export type BcraCatalogEntry = {
  readonly variableId: BcraVariableId;
  readonly description: string;
  readonly category: string;
  readonly seriesType: string;
  readonly frequency: SeriesFrequency;
  readonly unit: string;
  readonly currencyCode: BcraCurrencyCode;
  readonly firstReportedOn: string;
  /**
   * Lo que el catálogo dice de la última publicación. Cambia todos los días y
   * no define la variable: sirve sólo para conciliar contra lo guardado.
   */
  readonly lastReportedOn: string | null;
  readonly lastReportedValue: string | null;
};

export type BcraMethodologyEntry = {
  readonly variableId: BcraVariableId;
  readonly text: string | null;
};

export type BcraSeriesPoint = {
  /** La fecha del dato, tal como la fuente la escribe. No es su disponibilidad. */
  readonly periodOn: string;
  /** Decimal canónico leído del texto fuente. */
  readonly value: string;
};

export type RowRejection = {
  /** Posición dentro de la respuesta completa, contando desde 0. */
  readonly row: number;
  readonly variableId: BcraVariableId | null;
  readonly field: string;
  /**
   * La fecha de un punto rechazado por su valor. Sin ella no se sabe qué punto
   * fue, y la corrida no puede dar ningún punto guardado por retirado.
   */
  readonly periodOn?: string;
};

export type PageFailureCode =
  | "invalid_json"
  | "envelope_schema_changed"
  | "row_schema_changed"
  | "status_mismatch"
  | "offset_mismatch"
  | "limit_mismatch"
  | "page_size_mismatch"
  | "series_id_mismatch"
  | "unexpected_order"
  | "duplicate_key";

export type ParsedPage<Row> =
  | {
      readonly ok: true;
      /** Total de registros del recurso, normalizado por endpoint. */
      readonly total: number;
      readonly offset: number;
      readonly rows: readonly Row[];
      readonly rejections: readonly RowRejection[];
    }
  | { readonly ok: false; readonly code: PageFailureCode };

const EXACT_KEYS: ReadonlySet<string> = new Set(["valor", "ultValorInformado"]);

const resultsetSchema = z
  .object({
    count: z.number().int().min(0),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1),
  })
  .strict();

const pageEnvelopeSchema = z
  .object({
    status: z.number().int(),
    metadata: z.object({ resultset: resultsetSchema }).strict(),
    results: z.array(z.unknown()),
  })
  .strict();

const CATALOG_KEYS = [
  "idVariable",
  "descripcion",
  "categoria",
  "tipoSerie",
  "periodicidad",
  "unidadExpresion",
  "moneda",
  "primerFechaInformada",
  "ultFechaInformada",
  "ultValorInformado",
] as const;

const METHODOLOGY_KEYS = ["id", "detalle"] as const;
const SERIES_RESULT_KEYS = ["idVariable", "detalle"] as const;
const POINT_KEYS = ["fecha", "valor"] as const;

const isoDateSchema = z.iso.date();

function decode(body: Uint8Array | string): string | null {
  if (typeof body === "string") {
    return body;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function parseEnvelope(
  body: Uint8Array | string,
  httpStatus: number,
):
  | { readonly ok: true; readonly envelope: z.infer<typeof pageEnvelopeSchema> }
  | { readonly ok: false; readonly code: PageFailureCode } {
  const text = decode(body);

  if (text === null) {
    return { ok: false, code: "invalid_json" };
  }

  let parsed: unknown;

  try {
    parsed = parseJsonWithExactNumbers(text, EXACT_KEYS);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, code: "invalid_json" };
    }

    throw error;
  }

  const envelope = pageEnvelopeSchema.safeParse(parsed);

  if (!envelope.success) {
    return { ok: false, code: "envelope_schema_changed" };
  }

  if (envelope.data.status !== httpStatus) {
    return { ok: false, code: "status_mismatch" };
  }

  return { ok: true, envelope: envelope.data };
}

/** Un objeto con exactamente estas claves: una más o una menos es otro cable. */
function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const actual = Object.keys(value);

  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Espacios del texto colapsados —el catálogo trae `NBSP` sueltos— y NFC. */
export function normalizeSourceText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = normalizeSourceText(value);

  return text.length > 0 && text.length <= maxLength ? text : null;
}

function readDate(value: unknown): string | null {
  return typeof value === "string" && isoDateSchema.safeParse(value).success
    ? value
    : null;
}

function readExactDecimal(value: unknown): string | null {
  return value instanceof ExactJsonNumber
    ? canonicalDecimalFromJsonNumber(value.source)
    : null;
}

function checkPagination(
  resultset: z.infer<typeof resultsetSchema>,
  expected: {
    readonly offset: number;
    readonly limit: number;
    readonly total: number;
    readonly rows: number;
  },
): PageFailureCode | null {
  if (resultset.offset !== expected.offset) {
    return "offset_mismatch";
  }

  if (resultset.limit !== expected.limit) {
    return "limit_mismatch";
  }

  const promised = Math.max(
    0,
    Math.min(expected.limit, expected.total - expected.offset),
  );

  return expected.rows === promised ? null : "page_size_mismatch";
}

/**
 * Una página del catálogo. Medido: su `count` es lo que **queda** desde el
 * `offset`, no el total, así que el total es `offset + count`.
 */
export function parseCatalogPage(
  body: Uint8Array | string,
  input: { readonly httpStatus: number; readonly offset: number },
): ParsedPage<BcraCatalogEntry> {
  const parsed = parseEnvelope(body, input.httpStatus);

  if (!parsed.ok) {
    return parsed;
  }

  const { resultset } = parsed.envelope.metadata;
  const results = parsed.envelope.results;
  const total = resultset.offset + resultset.count;
  const failure = checkPagination(resultset, {
    offset: input.offset,
    limit: CATALOG_PAGE_LIMIT,
    total,
    rows: results.length,
  });

  if (failure !== null) {
    return { ok: false, code: failure };
  }

  const rows: BcraCatalogEntry[] = [];
  const rejections: RowRejection[] = [];
  const seen = new Set<number>();

  for (const [index, raw] of results.entries()) {
    if (!hasExactKeys(raw, CATALOG_KEYS)) {
      return { ok: false, code: "row_schema_changed" };
    }

    const row = input.offset + index;
    const variableId = isBcraVariableId(raw.idVariable) ? raw.idVariable : null;

    if (variableId === null) {
      rejections.push({ row, variableId: null, field: "idVariable" });
      continue;
    }

    if (seen.has(variableId)) {
      return { ok: false, code: "duplicate_key" };
    }

    seen.add(variableId);

    const description = readText(raw.descripcion, 300);
    const category = readText(raw.categoria, 120);
    const seriesType = readText(raw.tipoSerie, 120);
    const frequency =
      typeof raw.periodicidad === "string"
        ? (FREQUENCY_BY_CODE[raw.periodicidad] ?? null)
        : null;
    const unit = readText(raw.unidadExpresion, 120);
    const currencyCode = BCRA_CURRENCY_CODES.find(
      (code) => code === raw.moneda,
    );
    const firstReportedOn = readDate(raw.primerFechaInformada);
    const lastReportedOn =
      raw.ultFechaInformada === null ? null : readDate(raw.ultFechaInformada);
    const lastReportedValue =
      raw.ultValorInformado === null
        ? null
        : readExactDecimal(raw.ultValorInformado);

    const invalid: [string, boolean][] = [
      ["descripcion", description === null],
      ["categoria", category === null],
      ["tipoSerie", seriesType === null],
      ["periodicidad", frequency === null],
      ["unidadExpresion", unit === null],
      ["moneda", currencyCode === undefined],
      ["primerFechaInformada", firstReportedOn === null],
      [
        "ultFechaInformada",
        raw.ultFechaInformada !== null && lastReportedOn === null,
      ],
      [
        "ultValorInformado",
        raw.ultValorInformado !== null && lastReportedValue === null,
      ],
    ];
    const field = invalid.find(([, bad]) => bad)?.[0];

    if (field !== undefined) {
      rejections.push({ row, variableId, field });
      continue;
    }

    rows.push({
      variableId,
      description: description!,
      category: category!,
      seriesType: seriesType!,
      frequency: frequency!,
      unit: unit!,
      currencyCode: currencyCode!,
      firstReportedOn: firstReportedOn!,
      lastReportedOn,
      lastReportedValue,
    });
  }

  return { ok: true, total, offset: input.offset, rows, rejections };
}

/** Una página de metodologías. Acá el `count` sí es el total. */
export function parseMethodologyPage(
  body: Uint8Array | string,
  input: { readonly httpStatus: number; readonly offset: number },
): ParsedPage<BcraMethodologyEntry> {
  const parsed = parseEnvelope(body, input.httpStatus);

  if (!parsed.ok) {
    return parsed;
  }

  const { resultset } = parsed.envelope.metadata;
  const results = parsed.envelope.results;
  const failure = checkPagination(resultset, {
    offset: input.offset,
    limit: METHODOLOGY_PAGE_LIMIT,
    total: resultset.count,
    rows: results.length,
  });

  if (failure !== null) {
    return { ok: false, code: failure };
  }

  const rows: BcraMethodologyEntry[] = [];
  const rejections: RowRejection[] = [];
  const seen = new Set<number>();

  for (const [index, raw] of results.entries()) {
    if (!hasExactKeys(raw, METHODOLOGY_KEYS)) {
      return { ok: false, code: "row_schema_changed" };
    }

    const row = input.offset + index;
    const variableId = isBcraVariableId(raw.id) ? raw.id : null;

    if (variableId === null) {
      rejections.push({ row, variableId: null, field: "id" });
      continue;
    }

    if (seen.has(variableId)) {
      return { ok: false, code: "duplicate_key" };
    }

    seen.add(variableId);

    if (raw.detalle !== null && typeof raw.detalle !== "string") {
      rejections.push({ row, variableId, field: "detalle" });
      continue;
    }

    const text = raw.detalle === null ? null : normalizeSourceText(raw.detalle);

    if (text !== null && text.length > 4000) {
      rejections.push({ row, variableId, field: "detalle" });
      continue;
    }

    rows.push({ variableId, text: text === "" ? null : text });
  }

  return {
    ok: true,
    total: resultset.count,
    offset: input.offset,
    rows,
    rejections,
  };
}

/**
 * Una página de datos de la variable pedida. El `count` es el total de puntos;
 * el orden tiene que ser estrictamente descendente por fecha, porque la ventana
 * de revisiones es «la página más reciente» (ADR 0065, decisión 3).
 */
export function parseSeriesPage(
  body: Uint8Array | string,
  input: {
    readonly httpStatus: number;
    readonly variableId: BcraVariableId;
    readonly offset: number;
  },
): ParsedPage<BcraSeriesPoint> {
  const parsed = parseEnvelope(body, input.httpStatus);

  if (!parsed.ok) {
    return parsed;
  }

  const { resultset } = parsed.envelope.metadata;
  const results = parsed.envelope.results;

  if (results.length !== 1) {
    return {
      ok: false,
      code: results.length === 0 ? "page_size_mismatch" : "row_schema_changed",
    };
  }

  const result = results[0];

  if (
    !hasExactKeys(result, SERIES_RESULT_KEYS) ||
    !Array.isArray(result.detalle)
  ) {
    return { ok: false, code: "row_schema_changed" };
  }

  if (result.idVariable !== input.variableId) {
    return { ok: false, code: "series_id_mismatch" };
  }

  const detail: unknown[] = result.detalle;
  const failure = checkPagination(resultset, {
    offset: input.offset,
    limit: SERIES_PAGE_LIMIT,
    total: resultset.count,
    rows: detail.length,
  });

  if (failure !== null) {
    return { ok: false, code: failure };
  }

  const rows: BcraSeriesPoint[] = [];
  const rejections: RowRejection[] = [];

  for (const [index, raw] of detail.entries()) {
    if (!hasExactKeys(raw, POINT_KEYS)) {
      return { ok: false, code: "row_schema_changed" };
    }

    const row = input.offset + index;
    const periodOn = readDate(raw.fecha);

    if (periodOn === null) {
      rejections.push({ row, variableId: input.variableId, field: "fecha" });
      continue;
    }

    const previous = rows.at(-1);

    if (previous !== undefined && periodOn >= previous.periodOn) {
      // Una fecha repetida o un orden ascendente: la ventana dejaría de ser
      // lo más reciente, y eso no se arregla ordenando acá.
      return {
        ok: false,
        code:
          periodOn === previous.periodOn ? "duplicate_key" : "unexpected_order",
      };
    }

    const value = readExactDecimal(raw.valor);

    if (value === null) {
      // Un `valor` nulo no es un cero ni un retiro: el punto no se escribe.
      rejections.push({
        row,
        variableId: input.variableId,
        field: "valor",
        periodOn,
      });
      continue;
    }

    rows.push({ periodOn, value });
  }

  return {
    ok: true,
    total: resultset.count,
    offset: input.offset,
    rows,
    rejections,
  };
}

export type AssembledResource<Row> =
  | {
      readonly ok: true;
      readonly total: number;
      readonly rows: readonly Row[];
      readonly rejections: readonly RowRejection[];
    }
  | { readonly ok: false; readonly code: PageFailureCode | "total_changed" };

/**
 * Une las páginas de un recurso. El total tiene que ser el mismo en todas: si
 * cambia en medio de la descarga, la unión mezclaría dos publicaciones.
 *
 * `complete` exige haber leído el total; `window` acepta las primeras páginas
 * contiguas desde el `offset` 0, que es la ventana de revisiones.
 */
export function assemblePages<Row>(
  pages: readonly Extract<ParsedPage<Row>, { ok: true }>[],
  keyOf: (row: Row) => string,
  coverage: "complete" | "window",
): AssembledResource<Row> {
  const first = pages[0];

  if (first === undefined) {
    return { ok: false, code: "page_size_mismatch" };
  }

  const rows: Row[] = [];
  const rejections: RowRejection[] = [];
  const keys = new Set<string>();

  let expectedOffset = 0;

  for (const page of pages) {
    if (page.total !== first.total) {
      return { ok: false, code: "total_changed" };
    }

    if (page.offset !== expectedOffset) {
      return { ok: false, code: "offset_mismatch" };
    }

    expectedOffset += page.rows.length + page.rejections.length;

    for (const row of page.rows) {
      const key = keyOf(row);

      if (keys.has(key)) {
        return { ok: false, code: "duplicate_key" };
      }

      keys.add(key);
      rows.push(row);
    }

    rejections.push(...page.rejections);
  }

  if (coverage === "complete" && expectedOffset !== first.total) {
    return { ok: false, code: "page_size_mismatch" };
  }

  return { ok: true, total: first.total, rows, rejections };
}

/** Orden entre páginas de una serie: la última fecha de una antes que la primera de la siguiente. */
export function seriesPagesInOrder(
  pages: readonly Extract<ParsedPage<BcraSeriesPoint>, { ok: true }>[],
): boolean {
  let previous: string | null = null;

  for (const page of pages) {
    for (const point of page.rows) {
      if (previous !== null && point.periodOn >= previous) {
        return false;
      }

      previous = point.periodOn;
    }
  }

  return true;
}
