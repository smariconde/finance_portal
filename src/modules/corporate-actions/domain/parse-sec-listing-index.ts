import {
  parseSecSubmissions,
  type SecFiling,
} from "@/modules/fundamentals/domain/parse-sec-submissions";

/**
 * Lectura de `submissions` para eventos de listing: lo que el parser de
 * fundamentals no necesita y estos eventos sí.
 *
 * Contrato de cable medido el 2026-09-15 sobre KHC, Fiserv, Hologic, Electronic
 * Arts, AvalonBay, Franklin Templeton y Vivmark, sin conservar payload:
 *
 * - `filings.recent.items` es una columna paralela más, con los ítems de un 8-K
 *   separados por coma (`"2.01,3.01,5.01,9.01"`), vacía para los demás
 *   formularios y a veces con comas sueltas (`",,"` en un `EFFECT`);
 * - los primeros diez dígitos del accession son el CIK de **quien presentó**, no
 *   del sujeto: un `25-NSE` y un `CERT` los presenta el mercado, y así el índice
 *   del emisor dice qué mercado actuó sin leer el documento;
 * - `formerNames` es una lista de `{ name, from, to }` con instantes UTC; `to` es
 *   el borde en que EDGAR dejó de usar ese nombre.
 *
 * Tiene versión propia a propósito. `sec-submissions-1.0.0` es parte de la
 * identidad de las observaciones de companyfacts; cambiarlo para leer dos campos
 * que los hechos no usan volvería `ambiguous_revision` una reingesta idéntica.
 * El envelope se valida con ese mismo parser, así que un documento roto se
 * cuarentena igual en los dos caminos (`TM-05`).
 */
export const SEC_LISTING_INDEX_PARSER_VERSION = "sec-listing-index-1.0.0";

export type SecListingFiling = SecFiling & {
  /**
   * Ítems del 8-K. `[]` si la fila no trae ninguno; `null` si trae algo que no
   * tiene forma de ítem, para que una regla no lo lea como «sin 3.01».
   */
  readonly items: readonly string[] | null;
  /** CIK de quien presentó, tomado del accession: no es el sujeto. */
  readonly submitterCik: string;
};

export type SecFormerName = {
  readonly name: string;
  readonly from: string | null;
  readonly to: string;
};

export type SecListingIndex = {
  readonly cik: string;
  readonly entityName: string | null;
  readonly formerNames: readonly SecFormerName[];
  readonly filings: readonly SecListingFiling[];
  /**
   * Hasta dónde llega lo leído. Una regla que busca eventos posteriores a una
   * versión registrada tiene que saber si el índice reciente la cubre: si hay
   * archivos históricos y la aceptación más vieja es posterior, puede faltar
   * justo la presentación que decide.
   */
  readonly coverage: {
    readonly oldestAcceptedAt: string | null;
    readonly hasHistoryFiles: boolean;
  };
  readonly rejectedFilings: number;
  readonly rejectedFormerNames: number;
};

export type SecListingIndexParseResult =
  | ({ readonly ok: true; readonly parserVersion: string } & SecListingIndex)
  | {
      readonly ok: false;
      readonly parserVersion: string;
      readonly code: string;
    };

const ITEM = /^[0-9]{1,2}\.[0-9]{2}$/u;
const INSTANT =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInstant(value: unknown): string | null {
  if (typeof value !== "string" || !INSTANT.test(value)) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Ítems de un 8-K: los tokens vacíos no cuentan, uno sin forma invalida la fila. */
export function readSecItems(value: unknown): readonly string[] | null {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    return null;
  }

  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return tokens.every((token) => ITEM.test(token)) ? tokens : null;
}

export function parseSecListingIndex(
  payload: unknown,
): SecListingIndexParseResult {
  const parserVersion = SEC_LISTING_INDEX_PARSER_VERSION;
  const base = parseSecSubmissions(payload);

  if (!base.ok) {
    return { ok: false, parserVersion, code: base.code };
  }

  // `parseSecSubmissions` ya validó que el envelope y sus columnas existen.
  const recent = (payload as { filings: { recent: Record<string, unknown> } })
    .filings.recent;
  const accessions = recent.accessionNumber as unknown[];
  const rawItems = recent.items;

  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    return { ok: false, parserVersion, code: "column_missing" };
  }

  if (Array.isArray(rawItems) && rawItems.length !== accessions.length) {
    return { ok: false, parserVersion, code: "column_length_mismatch" };
  }

  const itemsByAccession = new Map<string, readonly string[] | null>();

  accessions.forEach((accession, row) => {
    if (typeof accession === "string") {
      // Sin columna no hay evidencia de ítems: `null`, no «ninguno».
      itemsByAccession.set(
        accession,
        Array.isArray(rawItems) ? readSecItems(rawItems[row]) : null,
      );
    }
  });

  const filings: SecListingFiling[] = base.filings.map((filing) => ({
    ...filing,
    items: itemsByAccession.get(filing.accessionNumber) ?? null,
    submitterCik: filing.accessionNumber.slice(0, 10),
  }));

  const rawFormerNames = (payload as Record<string, unknown>).formerNames ?? [];

  if (!Array.isArray(rawFormerNames)) {
    return { ok: false, parserVersion, code: "former_names_invalid" };
  }

  const formerNames: SecFormerName[] = [];
  let rejectedFormerNames = 0;

  for (const entry of rawFormerNames) {
    const name =
      isRecord(entry) && typeof entry.name === "string"
        ? entry.name.trim()
        : "";
    const to = isRecord(entry) ? readInstant(entry.to) : null;

    if (name.length === 0 || name.length > 256 || to === null) {
      rejectedFormerNames += 1;
      continue;
    }

    const from = readInstant(entry.from);

    if (from !== null && Date.parse(from) > Date.parse(to)) {
      rejectedFormerNames += 1;
      continue;
    }

    formerNames.push({ name, from, to });
  }

  const accepted = filings
    .map((filing) => filing.acceptedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    ok: true,
    parserVersion,
    cik: base.cik,
    entityName: base.entityName,
    formerNames,
    filings,
    coverage: {
      oldestAcceptedAt: accepted[0] ?? null,
      hasHistoryFiles: base.historyFiles.length > 0,
    },
    rejectedFilings: base.rejections.length,
    rejectedFormerNames,
  };
}
