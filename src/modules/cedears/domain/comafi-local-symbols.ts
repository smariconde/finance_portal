import type { XlsxRow } from "@/modules/reference-data/domain/xlsx-sheet-reader";
import {
  isValidIsin,
  normalizeLabel,
  type CedearPublication,
} from "./cedear-claim";

export const COMAFI_SYMBOLS_VERSION = "comafi-local-symbols-1.0.0";
export const BYMA_SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/u;

/** Only local identity: ratios and all other fields remain those of the JSON. */
export function withComafiLocalSymbols(
  publication: Extract<CedearPublication, { ok: true }>,
  rows: readonly XlsxRow[],
): CedearPublication {
  const text = (row: XlsxRow, column: string) =>
    row.cells.get(column)?.text.trim() ?? "";
  const header = rows.findIndex(
    (row) =>
      normalizeLabel(text(row, "C")) === "identificacion mercado" &&
      normalizeLabel(text(row, "D")) === "codigo caja de valores" &&
      normalizeLabel(text(row, "E")) === "isin cedear",
  );
  if (header < 0) return { ok: false, code: "payload_unparsable" };
  const byIsin = new Map<string, { symbol: string; code: string }[]>();
  for (const row of rows.slice(header + 1)) {
    const isin = text(row, "E").toUpperCase();
    if (!isValidIsin(isin)) continue;
    const entries = byIsin.get(isin) ?? [];
    entries.push({
      symbol: text(row, "C").toUpperCase(),
      code: text(row, "D"),
    });
    byIsin.set(isin, entries);
  }
  return {
    ...publication,
    parserVersion: "comafi-products-1.1.0",
    claims: publication.claims.map((claim) => {
      const entries = byIsin.get(claim.cedearIsin) ?? [];
      const entry = entries.length === 1 ? entries[0] : undefined;
      return {
        ...claim,
        bymaSymbol:
          entry !== undefined &&
          entry.code === claim.cajaValoresCode &&
          BYMA_SYMBOL_PATTERN.test(entry.symbol)
            ? entry.symbol
            : null,
      };
    }),
  };
}
