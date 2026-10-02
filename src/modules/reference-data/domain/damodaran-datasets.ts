import { htmlToText } from "@/modules/ingestion/domain/html-text";

import type { ReferencePublication, ReferenceRow } from "./reference-release";

/**
 * Los datasets de Damodaran que la Fase 3 usa (`F3-04`, ADR 0032): betas por
 * industria de EE. UU., riesgo país, ERP implícita histórica y la tabla de
 * rating sintético por cobertura de intereses.
 *
 * Se leen de la versión **HTML** de cada página, la misma tabla que el `.xls`:
 * leer el `.xls` exigiría una dependencia nueva para un formato binario, y la
 * página publica las mismas cifras con los mismos encabezados.
 *
 * Cada parser **verifica los encabezados** antes de leer una fila, como el de
 * Caja de Valores: una columna agregada o corrida haría leer la beta de la
 * columna de impuestos, y eso tiene que rechazar la publicación entera.
 */
export const DAMODARAN_SOURCE_ID = "damodaran-current-data";
export const DAMODARAN_PARSER_VERSION = "damodaran-html-1.0.0";

const BASE = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/";

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

export type DamodaranDataset = TableDataset | RatingsDataset;

export const DAMODARAN_DATASETS: readonly DamodaranDataset[] = Object.freeze([
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
    url: `${BASE}ctryprem.html`,
    shape: "table",
    keyHeader: "country",
    requiredKey: "united-states",
    minimumRows: 100,
    fields: [
      { field: "moodys_rating", header: "moody's rating", kind: "text" },
      {
        field: "default_spread",
        header: "adj. default spread",
        kind: "percent",
      },
      {
        field: "country_risk_premium",
        header: "country risk premium",
        kind: "percent",
      },
      {
        field: "equity_risk_premium",
        header: "equity risk premium",
        kind: "percent",
      },
      {
        field: "corporate_tax_rate",
        header: "corporate tax rate",
        kind: "percent",
      },
      { field: "sovereign_cds", header: "sovereign", kind: "percent" },
      {
        field: "equity_risk_premium_cds",
        header: "erp based on sovereign",
        kind: "percent",
      },
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

export function parseDamodaranDataset(
  dataset: DamodaranDataset,
  html: string,
): ReferencePublication {
  return dataset.shape === "table"
    ? parseTable(dataset, html)
    : parseRatings(dataset, html);
}
