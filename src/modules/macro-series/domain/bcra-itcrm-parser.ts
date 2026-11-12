import { z } from "zod";

import { readXlsxSheets } from "@/modules/reference-data/domain/xlsx-sheet-reader";

export const BCRA_ITCRM_PARSER_VERSION = "bcra-itcrm-xlsx-1.0.0";
export const BCRA_ITCRM_SOURCE_URL =
  "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/itcrm-serie.xlsx";
export const BCRA_ITCRM_BASE = "17-12-2015=100";

const SHEET = "ITCRM y bilaterales";
const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u);

export type ItcrmPoint = {
  readonly on: string;
  /** The decimal written in the workbook, without binary rounding. */
  readonly value: string;
};

export type ItcrmParseResult =
  | { readonly ok: true; readonly points: readonly ItcrmPoint[] }
  | { readonly ok: false; readonly code: string };

/** Excel's 1900 date system, including its historical leap-day bug. */
function excelDay(serial: string): string | null {
  if (!/^[1-9]\d{0,5}$/u.test(serial)) return null;
  const day = Number(serial);
  if (day < 61 || day > 100_000) return null;
  return new Date(Date.UTC(1899, 11, 30) + day * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Only the daily multilateral column is admitted; bilateral and monthly tabs are ignored. */
export function parseBcraItcrmWorkbook(bytes: Uint8Array): ItcrmParseResult {
  const workbook = readXlsxSheets(bytes, [SHEET], {
    // The official daily sheet was 8.83 MB inflated on 2026-11-12.
    maxPartBytes: 12 * 1024 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
  if (!workbook.ok) return { ok: false, code: `xlsx_${workbook.code}` };
  const rows = workbook.sheets.get(SHEET) ?? [];
  const cell = (index: number, column: string) =>
    rows[index]?.cells.get(column)?.text.trim() ?? "";
  if (
    cell(0, "A") !== "Índices con base 17-12-15=100" ||
    cell(1, "A") !== "Período" ||
    cell(1, "B") !== "ITCRM"
  ) {
    return { ok: false, code: "header_changed" };
  }

  const points: ItcrmPoint[] = [];
  let previous = "";
  let footer = false;
  for (const row of rows.slice(2)) {
    const date = row.cells.get("A")?.text.trim() ?? "";
    const value = row.cells.get("B")?.text.trim() ?? "";
    if (date === "" && value === "") {
      footer = true;
      continue;
    }
    const on = excelDay(date);
    if (on === null) {
      if (/^\d/u.test(date) || value !== "") {
        return { ok: false, code: "observation_invalid" };
      }
      footer = true;
      continue;
    }
    if (
      footer ||
      on <= previous ||
      !decimal.safeParse(value).success ||
      !Number.isFinite(Number(value)) ||
      Number(value) <= 0
    ) {
      return { ok: false, code: "observation_invalid" };
    }
    points.push({ on, value });
    previous = on;
  }
  if (points.length < 1_000) return { ok: false, code: "history_missing" };
  return { ok: true, points };
}
