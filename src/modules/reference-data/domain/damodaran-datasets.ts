import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import { htmlToText } from "@/modules/ingestion/domain/html-text";

import type { ReferencePublication, ReferenceRow } from "./reference-release";
import {
  readXlsxSheets,
  type XlsxCell,
  type XlsxRow,
} from "./xlsx-sheet-reader";

/**
 * Los datasets de Damodaran que la Fase 3 usa (`F3-04`, ADR 0032): betas por
 * industria de EE. UU., riesgo país, ERP implícita histórica y la tabla de
 * rating sintético por cobertura de intereses.
 *
 * Betas, ERP y ratings se leen de la versión **HTML** de cada página, la misma
 * tabla que el `.xls`. El riesgo país se lee del `.xlsx` (ADR 0034): las regiones
 * sólo se publican ahí, y países y regiones tienen que salir de la misma
 * descarga. El libro lo abre un lector propio, sin dependencia.
 *
 * Cada parser **verifica los encabezados** antes de leer una fila, como el de
 * Caja de Valores: una columna agregada o corrida haría leer la beta de la
 * columna de impuestos, y eso tiene que rechazar la publicación entera.
 */
export const DAMODARAN_SOURCE_ID = "damodaran-current-data";
export const DAMODARAN_PARSER_VERSION = "damodaran-html-1.0.0";
/** El riesgo país y sus regiones, leídos del `.xlsx` (ADR 0034). */
export const DAMODARAN_WORKBOOK_PARSER_VERSION = "damodaran-xlsx-1.0.0";

const BASE = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/";
const WORKBOOK_BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/";

/**
 * El archivo vigente del riesgo país. Cambia de nombre en cada actualización
 * (`ctryprem.xlsx` en enero, `ctrypremApr26.xlsx`, `ctrypremJuly26.xlsx`):
 * cambiarlo es un diff revisable, como el pin del universo, y el runtime nunca
 * resuelve «el último» por su cuenta. La allowlist abre esta ruta exacta.
 */
export const DAMODARAN_COUNTRY_RISK_WORKBOOK = Object.freeze({
  url: `${WORKBOOK_BASE}ctrypremJuly26.xlsx`,
  /** Cómo lo nombra el índice de datasets; nunca es la disponibilidad. */
  publishedLabel: "July 2026",
});

type FieldKind = "decimal" | "percent" | "integer" | "text";

type FieldSpec = {
  readonly field: string;
  /** Prefijo del encabezado, en minúsculas y sin espacios repetidos. */
  readonly header: string;
  readonly kind: FieldKind;
};

type TableDataset = {
  readonly datasetId: string;
  readonly url: string;
  readonly shape: "table";
  readonly keyHeader: string;
  readonly fields: readonly FieldSpec[];
  /** Una fila que tiene que estar: sin ella, la página se leyó mal. */
  readonly requiredKey: string;
  readonly minimumRows: number;
};

type RatingsDataset = {
  readonly datasetId: string;
  readonly url: string;
  readonly shape: "ratings";
  readonly minimumRows: number;
};

type WorkbookFieldKind = "decimal" | "text";

type WorkbookColumn = {
  /** Prefijo del encabezado, en minúsculas y sin espacios repetidos. */
  readonly header: string;
  /** `null`: la columna se verifica pero no se guarda. */
  readonly field: string | null;
  readonly kind: WorkbookFieldKind;
};

type WorkbookDataset = {
  readonly datasetId: string;
  readonly url: string;
  readonly shape: "workbook";
  readonly sheet: string;
  readonly keyHeader: string;
  /** Las columnas desde la B, en orden. */
  readonly columns: readonly WorkbookColumn[];
  /**
   * `detail`: las filas de país, que nombran su región. `region_summary`: las
   * filas que cierran cada región —región vacía y peso total 1—, reconocidas
   * por eso y no por su posición.
   */
  readonly selection: "detail" | "region_summary";
  readonly requiredKey: string;
  readonly minimumRows: number;
  readonly publishedLabel: string;
};

type FailureWorkbookDataset = {
  readonly datasetId: string;
  readonly url: string;
  readonly shape: "failure_workbook";
  readonly sheet: string;
};
export type DamodaranDataset =
  TableDataset | RatingsDataset | WorkbookDataset | FailureWorkbookDataset;

export const DAMODARAN_FAILURE_WORKBOOK = Object.freeze({
  url: "https://pages.stern.nyu.edu/~adamodar/pc/fcffsimpleginzu.xlsx",
  sheet: "Failure Rate worksheet",
});
export const DAMODARAN_FAILURE_PARSER_VERSION = "damodaran-failure-rates-1.0.0";

export const DAMODARAN_DATASETS: readonly DamodaranDataset[] = Object.freeze([
  {
    datasetId: "damodaran.failure-rates",
    shape: "failure_workbook",
    ...DAMODARAN_FAILURE_WORKBOOK,
  },
  {
    datasetId: "damodaran.betas-us",
    url: `${BASE}Betas.html`,
    shape: "table",
    keyHeader: "industry name",
    requiredKey: "total-market-without-financials",
    minimumRows: 50,
    fields: [
      { field: "firms", header: "number of firms", kind: "integer" },
      { field: "beta", header: "beta", kind: "decimal" },
      { field: "debt_to_equity", header: "d/e ratio", kind: "percent" },
      {
        field: "effective_tax_rate",
        header: "effective tax rate",
        kind: "percent",
      },
      { field: "unlevered_beta", header: "unlevered beta", kind: "decimal" },
      {
        field: "cash_to_firm_value",
        header: "cash/firm value",
        kind: "percent",
      },
      {
        field: "unlevered_beta_cash_corrected",
        header: "unlevered beta corrected for cash",
        kind: "decimal",
      },
      { field: "hilo_risk", header: "hilo risk", kind: "decimal" },
      {
        field: "equity_volatility",
        header: "standard deviation of equity",
        kind: "percent",
      },
      {
        field: "operating_income_volatility",
        header: "standard deviation in operating income",
        kind: "percent",
      },
    ],
  },
  {
    datasetId: "damodaran.country-risk",
    url: DAMODARAN_COUNTRY_RISK_WORKBOOK.url,
    shape: "workbook",
    sheet: "Regional breakdown",
    keyHeader: "country",
    selection: "detail",
    requiredKey: "united-states",
    minimumRows: 100,
    publishedLabel: DAMODARAN_COUNTRY_RISK_WORKBOOK.publishedLabel,
    columns: [
      { header: "gdp (in millions)", field: "gdp_millions", kind: "decimal" },
      { header: "moody's rating", field: "moodys_rating", kind: "text" },
      { header: "sovereign cds", field: "sovereign_cds", kind: "decimal" },
      {
        header: "adj. default spread",
        field: "default_spread",
        kind: "decimal",
      },
      {
        header: "equity risk premium",
        field: "equity_risk_premium",
        kind: "decimal",
      },
      {
        header: "country risk premium",
        field: "country_risk_premium",
        kind: "decimal",
      },
      {
        header: "corporate tax rate",
        field: "corporate_tax_rate",
        kind: "decimal",
      },
      { header: "region", field: "region", kind: "text" },
    ],
  },
  {
    datasetId: "damodaran.country-risk-regions",
    url: DAMODARAN_COUNTRY_RISK_WORKBOOK.url,
    shape: "workbook",
    sheet: "Regional Weighted Averages",
    keyHeader: "country",
    selection: "region_summary",
    requiredKey: "north-america",
    minimumRows: 9,
    publishedLabel: DAMODARAN_COUNTRY_RISK_WORKBOOK.publishedLabel,
    columns: [
      { header: "gdp (in millions)", field: "gdp_millions", kind: "decimal" },
      { header: "moody's rating", field: null, kind: "text" },
      {
        header: "adj. default spread",
        field: "default_spread",
        kind: "decimal",
      },
      {
        header: "equity risk premium",
        field: "equity_risk_premium",
        kind: "decimal",
      },
      {
        header: "country risk premium",
        field: "country_risk_premium",
        kind: "decimal",
      },
      {
        header: "corporate tax rate",
        field: "corporate_tax_rate",
        kind: "decimal",
      },
      { header: "region", field: null, kind: "text" },
      { header: "gdp weight", field: null, kind: "decimal" },
    ],
  },
  {
    datasetId: "damodaran.implied-erp",
    url: `${BASE}histimpl.html`,
    shape: "table",
    keyHeader: "year",
    requiredKey: "2020",
    minimumRows: 50,
    fields: [
      { field: "earnings_yield", header: "earnings yield", kind: "percent" },
      { field: "dividend_yield", header: "dividend yield", kind: "percent" },
      { field: "sp500_level", header: "s&p 500", kind: "decimal" },
      { field: "earnings", header: "earnings", kind: "decimal" },
      { field: "dividends", header: "dividends", kind: "decimal" },
      { field: "treasury_bond_rate", header: "t.bond rate", kind: "percent" },
      { field: "smoothed_growth", header: "smoothed growth", kind: "percent" },
      { field: "implied_erp", header: "implied erp (fcfe)", kind: "percent" },
    ],
  },
  {
    datasetId: "damodaran.synthetic-ratings",
    url: `${BASE}ratings.html`,
    shape: "ratings",
    minimumRows: 20,
  },
]);

export function findDamodaranDataset(
  datasetId: string,
): DamodaranDataset | null {
  return (
    DAMODARAN_DATASETS.find((dataset) => dataset.datasetId === datasetId) ??
    null
  );
}

/** Más filas que esto no es una tabla de Damodaran, es una página rota. */
const MAX_ROWS = 1000;

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

function rowsOf(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
    [...row[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/giu)].map((cell) =>
      htmlToText(cell[1]!),
    ),
  );
}

/** Mueve el punto decimal sin pasar por `number`: un porcentaje exacto sigue exacto. */
export function percentToFraction(digits: string): string {
  const negative = digits.startsWith("-");
  const unsigned = negative ? digits.slice(1) : digits;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = whole.padStart(3, "0");
  const integer = padded.slice(0, -2).replace(/^0+(?=\d)/u, "");
  const decimals = (padded.slice(-2) + fraction).replace(/0+$/u, "");
  const value = decimals.length === 0 ? integer : `${integer}.${decimals}`;

  return negative && value !== "0" ? `-${value}` : value;
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

/**
 * Un valor de celda. `NA` y la celda vacía son `null` —la fuente no lo da—; un
 * texto que no es lo que la columna declara es un rechazo, nunca un cero.
 */
function parseCell(
  raw: string,
  kind: FieldKind,
): { ok: true; value: string | null } | { ok: false } {
  const text = raw.replace(/,/gu, "").trim();

  if (text === "" || text.toUpperCase() === "NA") {
    return { ok: true, value: null };
  }

  switch (kind) {
    case "percent": {
      const match = /^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)%$/u.exec(text);
      return match === null
        ? { ok: false }
        : { ok: true, value: percentToFraction(match[1]!) };
    }
    case "decimal":
      return DECIMAL.test(text) ? { ok: true, value: text } : { ok: false };
    case "integer":
      return /^(?:0|[1-9][0-9]*)$/u.test(text)
        ? { ok: true, value: text }
        : { ok: false };
    case "text":
      return text.length <= 64 ? { ok: true, value: text } : { ok: false };
  }
}

/** Clave estable: la etiqueta sin la nota entre paréntesis, en kebab-case. */
export function rowKeyOf(label: string): string {
  return label
    .replace(/\(updated[^)]*\)/giu, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 128);
}

/** La fecha tal como la página la escribe, para leerla; no es la disponibilidad. */
export function publishedLabelOf(html: string): string | null {
  // La exportación de Excel abre con decenas de KB de estilos: se lee el
  // documento entero, que igual está acotado por la allowlist.
  const text = htmlToText(html.replace(/<style[\s\S]*?<\/style>/giu, ""));
  const patterns = [
    /Last updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/u,
    /Data used is as of\s*([A-Z][a-z]+ \d{4})/u,
    /Date\s*:\s*([A-Z][a-z]+ \d{4})/u,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match[1]!;
  }

  return null;
}

function parseTable(dataset: TableDataset, html: string): ReferencePublication {
  const rows = rowsOf(html);
  const headerIndex = rows.findIndex(
    (cells) =>
      cells.length > 0 && normalizeHeader(cells[0]!) === dataset.keyHeader,
  );

  if (headerIndex < 0) {
    return { ok: false, code: "header_row_missing" };
  }

  const headers = rows[headerIndex]!.map(normalizeHeader);
  const headersMatch =
    headers.length >= dataset.fields.length + 1 &&
    dataset.fields.every((spec, index) =>
      headers[index + 1]!.startsWith(spec.header),
    );

  if (!headersMatch) {
    return { ok: false, code: "header_mismatch" };
  }

  const parsed: ReferenceRow[] = [];
  const rejections: { row: number; field: string }[] = [];
  const seen = new Set<string>();

  for (const [offset, cells] of rows.slice(headerIndex + 1).entries()) {
    const label = cells[0]?.trim() ?? "";

    // La tabla termina en la primera fila sin etiqueta.
    if (label === "") break;

    if (parsed.length >= MAX_ROWS) {
      return { ok: false, code: "too_many_rows" };
    }

    const key = rowKeyOf(label);

    if (key === "" || seen.has(key)) {
      rejections.push({ row: offset, field: "key" });
      continue;
    }

    const values: Record<string, string | null> = {};
    let rejected = false;

    for (const [index, spec] of dataset.fields.entries()) {
      const cell = parseCell(cells[index + 1] ?? "", spec.kind);

      if (!cell.ok) {
        rejections.push({ row: offset, field: spec.field });
        rejected = true;
        break;
      }

      values[spec.field] = cell.value;
    }

    if (rejected) continue;

    seen.add(key);
    parsed.push({ key, label: label.slice(0, 160), values });
  }

  if (parsed.length < dataset.minimumRows || !seen.has(dataset.requiredKey)) {
    return { ok: false, code: "too_few_rows" };
  }

  return {
    ok: true,
    datasetId: dataset.datasetId,
    parserVersion: DAMODARAN_PARSER_VERSION,
    publishedLabel: publishedLabelOf(html),
    rows: parsed,
    rejections,
  };
}

/**
 * La tabla de rating sintético son **dos** tablas lado a lado en una sola: la de
 * empresas no financieras grandes y la de financieras, con sus propios rangos de
 * cobertura y los mismos ratings. Cada fila produce una banda de cada lado.
 */
function parseRatings(
  dataset: RatingsDataset,
  html: string,
): ReferencePublication {
  const rows = rowsOf(html);
  const headerIndex = rows.findIndex(
    (cells) =>
      cells[0]?.trim() === ">" &&
      normalizeHeader(cells[2] ?? "") === "rating is",
  );

  if (headerIndex < 0) {
    return { ok: false, code: "header_row_missing" };
  }

  const headers = rows[headerIndex]!.map(normalizeHeader);
  const expected = [
    ">",
    "≤ to",
    "rating is",
    "spread is",
    "",
    "greater than",
    "≤ to",
    "rating is",
    "spread is",
  ];

  if (
    headers.length < expected.length ||
    !expected.every((header, index) => headers[index] === header)
  ) {
    return { ok: false, code: "header_mismatch" };
  }

  const sides = [
    { prefix: "large-nonfinancial", offset: 0, label: "Large non-financial" },
    { prefix: "financial", offset: 5, label: "Financial service" },
  ] as const;
  const parsed: ReferenceRow[] = [];
  const rejections: { row: number; field: string }[] = [];

  for (const [index, cells] of rows.slice(headerIndex + 1).entries()) {
    if ((cells[0] ?? "").trim() === "") break;

    for (const side of sides) {
      const [above, atMost, rating, spread] = [0, 1, 2, 3].map(
        (column) => cells[side.offset + column] ?? "",
      );
      const parsedAbove = parseCell(above!, "decimal");
      const parsedAtMost = parseCell(atMost!, "decimal");
      const parsedRating = parseCell(rating!, "text");
      const parsedSpread = parseCell(spread!, "percent");

      if (
        !parsedAbove.ok ||
        !parsedAtMost.ok ||
        !parsedRating.ok ||
        !parsedSpread.ok
      ) {
        rejections.push({ row: index, field: side.prefix });
        continue;
      }

      parsed.push({
        key: `${side.prefix}-${String(index + 1).padStart(2, "0")}`,
        label: `${side.label} ${parsedRating.value ?? ""}`.trim(),
        values: {
          coverage_above: parsedAbove.value,
          coverage_at_most: parsedAtMost.value,
          rating: parsedRating.value,
          spread: parsedSpread.value,
        },
      });
    }
  }

  if (parsed.length < dataset.minimumRows) {
    return { ok: false, code: "too_few_rows" };
  }

  return {
    ok: true,
    datasetId: dataset.datasetId,
    parserVersion: DAMODARAN_PARSER_VERSION,
    publishedLabel: publishedLabelOf(html),
    rows: parsed,
    rejections,
  };
}

/**
 * El número de una celda como decimal canónico, moviendo el punto sin pasar por
 * `number`: `4.2000000000000003E-2` es `0.042000000000000003`, el mismo valor
 * exacto que el Excel guarda.
 */
export function numberTextToDecimal(text: string): string | null {
  const match = /^(-?)([0-9]+)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]{1,2}))?$/u.exec(
    text.trim(),
  );

  if (match === null) return null;

  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const digits = `${whole}${fraction}`;
  const point = whole!.length + Number(exponent);
  const padded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer = "0", decimals = ""] = padded.split(".");
  const trimmedInteger = integer.replace(/^0+(?=[0-9])/u, "");
  const trimmedDecimals = decimals.replace(/0+$/u, "");
  const value =
    trimmedDecimals === ""
      ? trimmedInteger
      : `${trimmedInteger}.${trimmedDecimals}`;

  if (value.length > 60) return null;

  return sign === "-" && value !== "0" ? `-${value}` : value;
}

function workbookCell(
  cell: XlsxCell | undefined,
  kind: WorkbookFieldKind,
): { ok: true; value: string | null } | { ok: false } {
  // Vacía, `NA` o un error de fórmula (`#N/A`): la fuente no lo da.
  if (cell === undefined || cell.kind === "error") {
    return { ok: true, value: null };
  }

  const text = cell.text.trim();

  if (cell.kind === "string" && (text === "" || text.toUpperCase() === "NA")) {
    return { ok: true, value: null };
  }

  if (kind === "text") {
    return cell.kind === "string" && text.length <= 64
      ? { ok: true, value: text }
      : { ok: false };
  }

  const value = cell.kind === "number" ? numberTextToDecimal(text) : null;

  return value === null ? { ok: false } : { ok: true, value };
}

/** Letra de la columna `index` contando desde la A (0). */
function columnLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function isWholeWeight(cell: XlsxCell | undefined): boolean {
  // Un control, no un valor guardado: el peso sumado es 1 salvo el error de
  // redondeo del double (`0.99999999999999989`).
  return cell?.kind === "number" && Math.abs(Number(cell.text) - 1) < 1e-9;
}

export function parseDamodaranWorkbookDataset(
  dataset: WorkbookDataset,
  rows: readonly XlsxRow[],
): ReferencePublication {
  const textOf = (row: XlsxRow, column: string) => {
    const cell = row.cells.get(column);
    return cell?.kind === "string" ? normalizeHeader(cell.text) : "";
  };
  const headerIndex = rows.findIndex(
    (row) => textOf(row, "A") === dataset.keyHeader,
  );

  if (headerIndex < 0) {
    return { ok: false, code: "header_row_missing" };
  }

  const header = rows[headerIndex]!;
  const headersMatch = dataset.columns.every((column, index) =>
    textOf(header, columnLetter(index + 1)).startsWith(column.header),
  );

  if (!headersMatch) {
    return { ok: false, code: "header_mismatch" };
  }

  const columnOf = (headerName: string) =>
    columnLetter(
      dataset.columns.findIndex((column) => column.header === headerName) + 1,
    );
  const regionColumn = columnOf("region");
  const weightColumn =
    dataset.selection === "region_summary" ? columnOf("gdp weight") : null;
  const parsed: ReferenceRow[] = [];
  const rejections: { row: number; field: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const labelCell = row.cells.get("A");
    const label = labelCell?.kind === "string" ? labelCell.text.trim() : "";

    if (label === "") continue;

    const region = row.cells.get(regionColumn);
    const named = region?.kind === "string" && region.text.trim() !== "";
    const selected =
      dataset.selection === "detail"
        ? named
        : !named && isWholeWeight(row.cells.get(weightColumn!));

    if (!selected) continue;

    if (parsed.length >= MAX_ROWS) {
      return { ok: false, code: "too_many_rows" };
    }

    const key = rowKeyOf(label);

    if (key === "" || seen.has(key)) {
      rejections.push({ row: row.index, field: "key" });
      continue;
    }

    const values: Record<string, string | null> = {};
    let rejected = false;

    for (const [index, column] of dataset.columns.entries()) {
      if (column.field === null) continue;

      const cell = workbookCell(
        row.cells.get(columnLetter(index + 1)),
        column.kind,
      );

      if (!cell.ok) {
        rejections.push({ row: row.index, field: column.field });
        rejected = true;
        break;
      }

      values[column.field] = cell.value;
    }

    if (rejected) continue;

    seen.add(key);
    parsed.push({ key, label: label.slice(0, 160), values });
  }

  if (parsed.length < dataset.minimumRows || !seen.has(dataset.requiredKey)) {
    return { ok: false, code: "too_few_rows" };
  }

  return {
    ok: true,
    datasetId: dataset.datasetId,
    parserVersion: DAMODARAN_WORKBOOK_PARSER_VERSION,
    publishedLabel: dataset.publishedLabel,
    rows: parsed,
    rejections,
  };
}

/**
 * Lee una descarga de Damodaran: la página HTML de su tabla o el libro `.xlsx`
 * del riesgo país. El libro rechaza la publicación entera con el código del
 * lector si no se pudo abrir (`xlsx_*`).
 */
export function parseDamodaranDataset(
  dataset: DamodaranDataset,
  body: Uint8Array | string,
): ReferencePublication {
  if (dataset.shape === "workbook" || dataset.shape === "failure_workbook") {
    if (typeof body === "string") {
      return { ok: false, code: "workbook_expected" };
    }

    const workbook = readXlsxSheets(body, [dataset.sheet]);

    return workbook.ok
      ? dataset.shape === "failure_workbook"
        ? parseFailureRates(workbook.sheets.get(dataset.sheet)!)
        : parseDamodaranWorkbookDataset(
            dataset,
            workbook.sheets.get(dataset.sheet)!,
          )
      : { ok: false, code: `xlsx_${workbook.code}` };
  }

  const html =
    typeof body === "string" ? body : new TextDecoder("utf-8").decode(body);

  return dataset.shape === "table"
    ? parseTable(dataset, html)
    : parseRatings(dataset, html);
}

/** The corporate-rating table only; the age-based table below it is unrelated. */
function parseFailureRates(rows: readonly XlsxRow[]): ReferencePublication {
  const labels = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC/C"];
  const headers = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.cells.get("A")?.text.trim() === "Rating");
  if (headers.length !== 1)
    return { ok: false, code: "failure_header_mismatch" };
  const { row: header, index } = headers[0]!;
  if (
    !rows
      .slice(Math.max(0, index - 3), index)
      .some((row) =>
        row.cells
          .get("A")
          ?.text.startsWith(
            "Default Probabilities over time (1 - 10 year time horizons)",
          ),
      )
  )
    return { ok: false, code: "failure_title_mismatch" };
  const columns = Array.from({ length: 10 }, (_, i) =>
    String.fromCharCode(66 + i),
  );
  if (
    columns.some(
      (col, i) =>
        header.cells.get(col)?.kind !== "number" ||
        numberTextToDecimal(header.cells.get(col)!.text) !== String(i + 1),
    )
  )
    return { ok: false, code: "failure_horizons_mismatch" };
  const { parseDecimal } = createDecimalOperations((code) => new Error(code));
  const result: ReferenceRow[] = [];
  for (const [offset, label] of labels.entries()) {
    const row = rows[index + offset + 1];
    if (row?.cells.get("A")?.text !== label)
      return { ok: false, code: "failure_ratings_mismatch" };
    const values: Record<string, string> = {};
    let previous = parseDecimal("0", "probability");
    for (const [year, col] of columns.entries()) {
      const cell = row.cells.get(col);
      const value =
        cell?.kind === "number" ? numberTextToDecimal(cell.text) : null;
      if (value === null)
        return { ok: false, code: "failure_probability_invalid" };
      const probability = parseDecimal(value, "probability");
      if (probability.lt(previous) || probability.gt(1))
        return { ok: false, code: "failure_probability_invalid" };
      previous = probability;
      values[`year_${year + 1}`] = value;
    }
    result.push({
      key: label === "CCC/C" ? "ccc-c" : label.toLowerCase(),
      label,
      values,
    });
  }
  if (
    rows[index + 8]?.index === header.index + 8 &&
    rows[index + 8]?.cells.get("A")?.text.trim()
  )
    return { ok: false, code: "failure_extra_rating" };
  return {
    ok: true,
    datasetId: "damodaran.failure-rates",
    parserVersion: DAMODARAN_FAILURE_PARSER_VERSION,
    publishedLabel: null,
    rows: result,
    rejections: [],
  };
}
