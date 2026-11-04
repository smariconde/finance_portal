import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import { readXlsxSheets } from "@/modules/reference-data/domain/xlsx-sheet-reader";

/**
 * Reader of the Cámara Arbitral de Cereales price export (ADR 0071): one
 * workbook, one sheet, the product's whole history as day serial and price.
 * The layout is checked cell by cell before a row is read.
 */
export const BCR_CAC_PIZARRA_PARSER_VERSION = "bcr-cac-pizarra-1.0.0";

/**
 * Prices arrive as the cell's double (`176.099999999999994`); the board quotes
 * pesos with centavos. A value is taken to centavos only when the double sits
 * within a millionth of them, so a price with more digits is refused, never
 * rounded into another price.
 */
export const CAC_PESO_CENTS_VERSION = "cac-peso-cents-1.0.0";

/** The board prints «S/C» (sin cotización) on a session without a price. */
export const CAC_NO_QUOTE = "S/C";

const SHEET = "Worksheet";
const TITLE = "Consulta de precios";
const DATE_HEADER = "Fecha de operación";
const PRICE_HEADER = "Precio";
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/**
 * The serial's fraction is the load time: 0.10–0.50 in 2010–2020 and 0.125
 * (midnight in Buenos Aires, in UTC) since 2020-12-18. A fraction this late
 * could belong to the next local day, so it is refused instead of guessed.
 */
const MAX_DAY_FRACTION = 0.875;

export type CacPizarraPoint = {
  readonly periodOn: string;
  readonly value: string | null;
};

export type CacPizarraParseResult =
  | { readonly ok: true; readonly points: readonly CacPizarraPoint[] }
  | {
      readonly ok: false;
      readonly reason:
        | "unreadable_workbook"
        | "layout_changed"
        | "product_mismatch"
        | "invalid_date"
        | "invalid_price"
        | "price_not_in_cents"
        | "unexpected_order"
        | "empty";
    };

const decimal = createDecimalOperations((code) => new Error(code));

function dayOf(serial: string): string | null {
  if (!/^[1-9][0-9]{4}(?:\.[0-9]+)?$/u.test(serial)) return null;
  const [whole, fraction = "0"] = serial.split(".");
  if (Number(`0.${fraction}`) >= MAX_DAY_FRACTION) return null;
  return new Date(EXCEL_EPOCH_MS + Number(whole) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function centsOf(text: string): string | null | "invalid" {
  let price;
  try {
    price = decimal.parseDecimal(text, "price");
  } catch {
    return "invalid";
  }
  if (!price.gt(0)) return "invalid";
  const cents = decimal.parseDecimal(
    decimal.toFixedScale(price, 2, "price"),
    "price",
  );
  return price.minus(cents).abs().lt("0.000001")
    ? decimal.formatDecimal(cents, "price")
    : null;
}

export function parseCacPizarraExport(
  bytes: Uint8Array,
  product: string,
): CacPizarraParseResult {
  const read = readXlsxSheets(bytes, [SHEET]);
  if (!read.ok) return { ok: false, reason: "unreadable_workbook" };
  const rows = read.sheets.get(SHEET) ?? [];
  const filled = rows.filter((row) => row.cells.size > 0);
  const [title, heading, columns, ...data] = filled;
  const textOf = (
    row: (typeof filled)[number] | undefined,
    column: string,
  ): string | null => {
    const cell = row?.cells.get(column);
    return cell?.kind === "string" ? cell.text : null;
  };
  if (
    title?.cells.size !== 1 ||
    textOf(title, "D") !== TITLE ||
    heading?.cells.size !== 1 ||
    columns?.cells.size !== 2 ||
    textOf(columns, "A") !== DATE_HEADER ||
    textOf(columns, "B") !== PRICE_HEADER
  ) {
    return { ok: false, reason: "layout_changed" };
  }
  if (textOf(heading, "A") !== product) {
    return { ok: false, reason: "product_mismatch" };
  }
  if (data.length === 0) return { ok: false, reason: "empty" };

  const points: CacPizarraPoint[] = [];
  for (const row of data) {
    const date = row.cells.get("A");
    const price = row.cells.get("B");
    if (row.cells.size !== 2 || date?.kind !== "number" || !price) {
      return { ok: false, reason: "layout_changed" };
    }
    const periodOn = dayOf(date.text);
    if (periodOn === null) return { ok: false, reason: "invalid_date" };
    const previous = points.at(-1);
    if (previous && periodOn <= previous.periodOn) {
      return { ok: false, reason: "unexpected_order" };
    }
    if (price.kind === "string") {
      if (price.text !== CAC_NO_QUOTE) {
        return { ok: false, reason: "invalid_price" };
      }
      points.push({ periodOn, value: null });
      continue;
    }
    if (price.kind !== "number") return { ok: false, reason: "invalid_price" };
    const value = centsOf(price.text);
    if (value === "invalid") return { ok: false, reason: "invalid_price" };
    if (value === null) return { ok: false, reason: "price_not_in_cents" };
    points.push({ periodOn, value });
  }
  return { ok: true, points };
}

/** The export URL for a product: the whole history from the year 2000. */
export function cacPizarraExportUrl(
  productCode: string,
  untilOn: string,
): string {
  if (
    !/^[0-9]{1,3}$/u.test(productCode) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(untilOn)
  ) {
    throw new Error("invalid_pizarra_request");
  }
  const params = new URLSearchParams({
    product: productCode,
    type: "pizarra",
    date_start: "2000-01-01",
    date_end: untilOn,
    period: "day",
  });
  return `https://www.cac.bcr.com.ar/es/api/prices/987/export?${params.toString()}`;
}
