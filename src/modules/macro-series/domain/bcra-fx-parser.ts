import { z } from "zod";

import {
  canonicalDecimalFromJsonNumber,
  ExactJsonNumber,
  parseJsonWithExactNumbers,
} from "@/modules/fundamentals/domain/exact-json";

import { BCRA_FX_PAGE_LIMIT } from "./bcra-fx-source";
import {
  checkPagination,
  decode,
  hasExactKeys,
  readDate,
  readText,
  resultsetSchema,
  type BcraSeriesPoint,
  type PageFailureCode,
  type ParsedPage,
  type RowRejection,
} from "./bcra-monetary-parser";

/**
 * Parser de Estadísticas Cambiarias v1 (`bcra-cambiarias-v1-1.0.0`, ADR 0067).
 * Lee contra el cable medido el 2026-11-03, con los mismos dos niveles de
 * rechazo que el monetario: la página entera cuando el sobre, las claves, la
 * paginación o el orden cambian; la fila cuando un campo no se puede leer.
 *
 * Medido: `count`, `offset` y `limit` cuentan **cotizaciones**, no días, y un
 * día puede traer la misma moneda más de una vez. 29 días traen copias idénticas, que son
 * un punto; 5 traen valores distintos (el 2017-09-06, 37,35 y 17,215), y ese
 * día se rechaza por nombre en vez de elegir uno.
 */
const EXACT_KEYS: ReadonlySet<string> = new Set(["tipoPase", "tipoCotizacion"]);

const DAY_KEYS = ["fecha", "detalle"] as const;
const QUOTE_KEYS = [
  "codigoMoneda",
  "descripcion",
  "tipoPase",
  "tipoCotizacion",
] as const;
const CURRENCY_KEYS = ["codigo", "denominacion"] as const;

const quotesEnvelopeSchema = z
  .object({
    status: z.number().int(),
    metadata: z.object({ resultset: resultsetSchema }).strict(),
    results: z.array(z.unknown()),
  })
  .strict();

const currenciesEnvelopeSchema = z
  .object({ status: z.number().int(), results: z.array(z.unknown()) })
  .strict();

function parseJson(
  body: Uint8Array | string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: PageFailureCode } {
  const text = decode(body);

  if (text === null) {
    return { ok: false, code: "invalid_json" };
  }

  try {
    return { ok: true, value: parseJsonWithExactNumbers(text, EXACT_KEYS) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, code: "invalid_json" };
    }

    throw error;
  }
}

export type FxCurrencyEntry = {
  readonly isoCode: string;
  readonly name: string;
};

/**
 * El maestro de monedas: código ISO y denominación, nada más. Medido: el
 * maestro repite un código con dos nombres (`NIO`, «CORDOBA NICARAGUENSE» y
 * «CORDOBAS»). Un código repetido no rompe el maestro: queda **ambiguo** y no
 * se lee, porque cualquiera de los dos nombres podría ser el vigente.
 */
export function parseFxCurrencies(
  body: Uint8Array | string,
  httpStatus: number,
):
  | {
      readonly ok: true;
      readonly currencies: readonly FxCurrencyEntry[];
      readonly ambiguous: readonly string[];
    }
  | { readonly ok: false; readonly code: PageFailureCode } {
  const json = parseJson(body);

  if (!json.ok) {
    return json;
  }

  const envelope = currenciesEnvelopeSchema.safeParse(json.value);

  if (!envelope.success) {
    return { ok: false, code: "envelope_schema_changed" };
  }

  if (envelope.data.status !== httpStatus) {
    return { ok: false, code: "status_mismatch" };
  }

  const byCode = new Map<string, FxCurrencyEntry[]>();

  for (const raw of envelope.data.results) {
    if (!hasExactKeys(raw, CURRENCY_KEYS)) {
      return { ok: false, code: "row_schema_changed" };
    }

    const isoCode =
      typeof raw.codigo === "string" && /^[A-Z]{3}$/u.test(raw.codigo)
        ? raw.codigo
        : null;
    const name = readText(raw.denominacion, 120);

    if (isoCode === null || name === null) {
      return { ok: false, code: "row_schema_changed" };
    }

    byCode.set(isoCode, [...(byCode.get(isoCode) ?? []), { isoCode, name }]);
  }

  const currencies: FxCurrencyEntry[] = [];
  const ambiguous: string[] = [];

  for (const [isoCode, entries] of byCode) {
    if (new Set(entries.map((entry) => entry.name)).size === 1) {
      currencies.push(entries[0]!);
    } else {
      ambiguous.push(isoCode);
    }
  }

  return { ok: true, currencies, ambiguous };
}

/**
 * Una página de cotizaciones de una moneda, de la fecha más reciente a la más
 * vieja. El valor es `tipoCotizacion`, en pesos por unidad; `tipoPase` es la
 * paridad contra el dólar y no se guarda, porque la cotización ya la incluye.
 */
export function parseFxQuotesPage(
  body: Uint8Array | string,
  input: {
    readonly httpStatus: number;
    readonly isoCode: string;
    readonly isoNumeric: number;
    readonly offset: number;
  },
): ParsedPage<BcraSeriesPoint> {
  const json = parseJson(body);

  if (!json.ok) {
    return json;
  }

  const envelope = quotesEnvelopeSchema.safeParse(json.value);

  if (!envelope.success) {
    return { ok: false, code: "envelope_schema_changed" };
  }

  if (envelope.data.status !== input.httpStatus) {
    return { ok: false, code: "status_mismatch" };
  }

  const { resultset } = envelope.data.metadata;
  const days = envelope.data.results;
  let consumed = 0;

  for (const raw of days) {
    if (!hasExactKeys(raw, DAY_KEYS) || !Array.isArray(raw.detalle)) {
      return { ok: false, code: "row_schema_changed" };
    }

    consumed += (raw.detalle as unknown[]).length;
  }

  const failure = checkPagination(resultset, {
    offset: input.offset,
    limit: BCRA_FX_PAGE_LIMIT,
    total: resultset.count,
    rows: consumed,
  });

  if (failure !== null) {
    return { ok: false, code: failure };
  }

  const rows: BcraSeriesPoint[] = [];
  const rejections: RowRejection[] = [];
  let previous: string | null = null;

  for (const [index, raw] of days.entries()) {
    if (!hasExactKeys(raw, DAY_KEYS) || !Array.isArray(raw.detalle)) {
      return { ok: false, code: "row_schema_changed" };
    }

    const row = input.offset + index;
    const periodOn = readDate(raw.fecha);

    if (periodOn === null) {
      rejections.push({ row, variableId: input.isoNumeric, field: "fecha" });
      continue;
    }

    if (previous !== null && periodOn >= previous) {
      return {
        ok: false,
        code: periodOn === previous ? "duplicate_key" : "unexpected_order",
      };
    }

    previous = periodOn;
    const values = new Set<string>();
    let unreadable = false;

    for (const quote of raw.detalle as unknown[]) {
      if (!hasExactKeys(quote, QUOTE_KEYS)) {
        return { ok: false, code: "row_schema_changed" };
      }

      if (quote.codigoMoneda !== input.isoCode) {
        return { ok: false, code: "series_id_mismatch" };
      }

      const value =
        quote.tipoCotizacion instanceof ExactJsonNumber
          ? canonicalDecimalFromJsonNumber(quote.tipoCotizacion.source)
          : null;

      if (value === null || value === "0" || value.startsWith("-")) {
        unreadable = true;
      } else {
        values.add(value);
      }
    }

    // Sin cotización, con una ilegible o con dos distintas: el día no se
    // escribe, y queda nombrado para que no se dé por retirado.
    if (unreadable || values.size !== 1) {
      rejections.push({
        row,
        variableId: input.isoNumeric,
        field: "tipoCotizacion",
        periodOn,
      });
      continue;
    }

    rows.push({ periodOn, value: [...values][0]! });
  }

  return {
    ok: true,
    total: resultset.count,
    offset: input.offset,
    rows,
    rejections,
    consumed,
  };
}

export type FxQuotesPage = Extract<ParsedPage<BcraSeriesPoint>, { ok: true }>;

/**
 * Une las páginas de una moneda. Una página corta por cotización, así que un
 * día con copias puede quedar partido entre dos: se une con la misma regla que
 * dentro de una página —copias iguales son un punto, valores distintos
 * rechazan el día—. En una ventana, el último día de una página llena puede
 * seguir en la próxima, que no se pidió: se deja afuera en vez de leerlo a
 * medias.
 */
export function assembleFxPages(
  pages: readonly FxQuotesPage[],
  coverage: "complete" | "window",
):
  | {
      readonly ok: true;
      readonly total: number;
      readonly rows: readonly BcraSeriesPoint[];
      readonly rejections: readonly RowRejection[];
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly code: PageFailureCode | "total_changed" } {
  const first = pages[0];

  if (first === undefined) {
    return { ok: false, code: "page_size_mismatch" };
  }

  type Day = {
    periodOn: string;
    value: string | null;
    rejection: RowRejection | null;
  };
  const days: Day[] = [];
  let expectedOffset = 0;

  for (const page of pages) {
    if (page.total !== first.total) {
      return { ok: false, code: "total_changed" };
    }

    if (page.offset !== expectedOffset) {
      return { ok: false, code: "offset_mismatch" };
    }

    expectedOffset += page.consumed ?? 0;
    const pageDays: Day[] = [
      ...page.rows.map((row) => ({ ...row, rejection: null })),
      ...page.rejections.map((rejection) => ({
        periodOn: rejection.periodOn ?? "",
        value: null,
        rejection,
      })),
    ].sort((left, right) => right.periodOn.localeCompare(left.periodOn));

    for (const day of pageDays) {
      const previous = days.at(-1);

      if (previous !== undefined && day.periodOn === previous.periodOn) {
        // El mismo día a los dos lados de un corte de página.
        if (
          previous.rejection === null &&
          day.rejection === null &&
          previous.value === day.value
        ) {
          continue;
        }

        previous.value = null;
        previous.rejection ??= day.rejection ?? {
          row: 0,
          variableId: null,
          field: "tipoCotizacion",
          periodOn: day.periodOn,
        };
        continue;
      }

      if (previous !== undefined && day.periodOn > previous.periodOn) {
        return { ok: false, code: "unexpected_order" };
      }

      days.push(day);
    }
  }

  const complete = expectedOffset >= first.total;

  if (coverage === "complete" && !complete) {
    return { ok: false, code: "page_size_mismatch" };
  }

  if (!complete && days.length > 0) {
    days.pop();
  }

  return {
    ok: true,
    total: first.total,
    rows: days.flatMap((day) =>
      day.rejection === null && day.value !== null
        ? [{ periodOn: day.periodOn, value: day.value }]
        : [],
    ),
    rejections: days.flatMap((day) =>
      day.rejection === null ? [] : [day.rejection],
    ),
    complete,
  };
}
