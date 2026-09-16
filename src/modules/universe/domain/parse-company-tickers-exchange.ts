import {
  companyTickerAssignmentSchema,
  type CompanyTickerAssignment,
} from "./universe-source-records";

/**
 * Parser del formato de cable de `company_tickers_exchange.json`, la fuente
 * autoritativa ticker→CIK de la SEC.
 *
 * El archivo no es una lista de objetos: es una tabla, con los nombres de columna
 * en `fields` y las filas como arrays posicionales en `data`. Este parser lee el
 * encabezado en vez de fijar índices, que es la diferencia entre romperse y
 * detectarlo si la SEC reordena las columnas. Un índice hardcodeado seguiría
 * "funcionando" después de un reordenamiento y asignaría nombres como tickers.
 *
 * Dos cosas que este parser **no** hace, a propósito:
 *
 * - **No deduplica.** Un CIK aparece una vez por cada clase que cotiza, y dos
 *   filas con el mismo ticker son evidencia de ambigüedad que le corresponde
 *   resolver —o rechazar— a `resolve-constituents.ts`. Colapsarlas acá elegiría
 *   un emisor en silencio, que es justo lo que el modelo de identidad prohíbe.
 * - **No normaliza el CIK a diez dígitos.** Conserva los dígitos que publica la
 *   fuente; el relleno es normalización de identidad y vive en el grafo.
 *
 * Un fallo de forma del payload completo se distingue de una fila inválida: lo
 * primero es un parser roto y cuarentena el lote entero (`TM-05`), lo segundo es
 * una fila que se rechaza nombrada mientras el resto se publica.
 */
export const COMPANY_TICKERS_EXCHANGE_PARSER_VERSION =
  "company-tickers-exchange-1.0.0";

const REQUIRED_FIELDS = ["cik", "name", "ticker", "exchange"] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

export type CompanyTickersPayloadRejectionCode =
  /** El cuerpo no es el objeto tabular que declara el formato. */
  | "payload_not_tabular"
  /** Falta alguna de las columnas de las que depende la identidad. */
  | "required_field_missing"
  /** Una columna se declara dos veces: el encabezado no determina la posición. */
  | "duplicate_field"
  /** El archivo parsea pero no trae una sola fila utilizable. */
  | "no_usable_rows";

export type CompanyTickersRowRejectionCode =
  /** La fila no tiene tantas celdas como columnas declara el encabezado. */
  | "row_arity_mismatch"
  | "cik_invalid"
  | "name_missing"
  | "ticker_missing"
  | "exchange_invalid";

export type CompanyTickersRowRejection = {
  readonly row: number;
  readonly code: CompanyTickersRowRejectionCode;
  /** Nombre de la columna, nunca el valor recibido (`TM-02`). */
  readonly field: RequiredField | null;
};

export type CompanyTickersParseResult =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      /** Orden real de columnas del payload, para que la corrida lo registre. */
      readonly fieldOrder: readonly string[];
      readonly assignments: readonly CompanyTickerAssignment[];
      readonly rejections: readonly CompanyTickersRowRejection[];
    }
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: CompanyTickersPayloadRejectionCode;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * El CIK llega como número en el payload real —no como string con ceros a la
 * izquierda—, así que se aceptan las dos formas y se rechaza cualquier otra. Un
 * `1.5` o un negativo no son un CIK con ruido: son una fila que no se entiende.
 */
function readCik(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    return /^[0-9]{1,10}$/u.test(trimmed) && Number(trimmed) > 0
      ? String(Number(trimmed))
      : null;
  }

  return null;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

export function parseCompanyTickersExchange(
  payload: unknown,
): CompanyTickersParseResult {
  const parserVersion = COMPANY_TICKERS_EXCHANGE_PARSER_VERSION;

  if (
    !isRecord(payload) ||
    !Array.isArray(payload.fields) ||
    !Array.isArray(payload.data)
  ) {
    return { ok: false, parserVersion, code: "payload_not_tabular" };
  }

  const fieldOrder = payload.fields.map((field) =>
    typeof field === "string" ? field.trim().toLowerCase() : "",
  );

  if (new Set(fieldOrder).size !== fieldOrder.length) {
    return { ok: false, parserVersion, code: "duplicate_field" };
  }

  const columnOf = {} as Record<RequiredField, number>;

  for (const field of REQUIRED_FIELDS) {
    const index = fieldOrder.indexOf(field);

    if (index === -1) {
      return { ok: false, parserVersion, code: "required_field_missing" };
    }

    columnOf[field] = index;
  }

  const assignments: CompanyTickerAssignment[] = [];
  const rejections: CompanyTickersRowRejection[] = [];

  payload.data.forEach((row, index) => {
    const reject = (
      code: CompanyTickersRowRejectionCode,
      field: RequiredField | null,
    ): void => {
      rejections.push({ row: index, code, field });
    };

    if (!Array.isArray(row) || row.length !== fieldOrder.length) {
      reject("row_arity_mismatch", null);
      return;
    }

    const cik = readCik(row[columnOf.cik]);

    if (cik === null) {
      reject("cik_invalid", "cik");
      return;
    }

    const name = readText(row[columnOf.name]);

    if (name === null) {
      reject("name_missing", "name");
      return;
    }

    const ticker = readText(row[columnOf.ticker]);

    if (ticker === null) {
      reject("ticker_missing", "ticker");
      return;
    }

    const rawExchange = row[columnOf.exchange];

    // `null` es un valor legítimo y frecuente: hay filers sin mercado declarado.
    // Se conserva como ausencia para que el resolver lo rechace por
    // `missing_exchange` en vez de que el parser invente uno.
    if (rawExchange !== null && typeof rawExchange !== "string") {
      reject("exchange_invalid", "exchange");
      return;
    }

    const parsed = companyTickerAssignmentSchema.safeParse({
      cik,
      name,
      ticker,
      exchange: rawExchange === null ? null : readText(rawExchange),
    });

    if (!parsed.success) {
      reject("cik_invalid", null);
      return;
    }

    assignments.push(parsed.data);
  });

  if (assignments.length === 0) {
    // Un archivo que parsea y no deja una sola asignación utilizable no es un
    // universo vacío: es un parser roto, y no debe reemplazar al lote anterior.
    return { ok: false, parserVersion, code: "no_usable_rows" };
  }

  return { ok: true, parserVersion, fieldOrder, assignments, rejections };
}
