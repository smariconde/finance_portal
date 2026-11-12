import { readXlsxSheets } from "@/modules/reference-data/domain/xlsx-sheet-reader";

export const BCRA_REM_RELEASE_PARSER_VERSION = "bcra-rem-release-xlsx-1.0.0";

const SHEET = "Cuadros de resultados";
const NATIONAL_IPC = "Precios minoristas (IPC nivel general-Nacional; INDEC)";
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export type RemMonthlyForecast = {
  readonly roundMonth: string;
  readonly targetMonth: string;
  /** Median in percentage points, as written by the BCRA workbook. */
  readonly medianPercent: string;
};

export type RemReleaseParseResult =
  | { readonly ok: true; readonly forecasts: readonly RemMonthlyForecast[] }
  | { readonly ok: false; readonly code: string };

function excelMonth(serial: string): string | null {
  if (!/^[1-9]\d{0,5}$/u.test(serial)) return null;
  const day = Number(serial);
  if (day < 61 || day > 100_000) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + day * 86_400_000);
  // The release tables label each target with its calendar month's last day.
  if (
    date.getUTCDate() !==
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate()
  )
    return null;
  return date.toISOString().slice(0, 7);
}

/** One published REM release. The HTML page supplies its publication date separately. */
export function parseBcraRemReleaseWorkbook(
  bytes: Uint8Array,
  roundMonth: string,
): RemReleaseParseResult {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(roundMonth);
  if (!match) return { ok: false, code: "round_invalid" };
  const expectedTitle = `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
  const workbook = readXlsxSheets(bytes, [SHEET]);
  if (!workbook.ok) return { ok: false, code: `xlsx_${workbook.code}` };
  const rows = workbook.sheets.get(SHEET) ?? [];
  const byNumber = new Map(rows.map((row) => [row.index, row]));
  const cell = (row: number, column: string) =>
    byNumber.get(row)?.cells.get(column)?.text.trim() ?? "";
  if (
    !cell(2, "B").includes(`- BCRA - ${expectedTitle}`) ||
    cell(5, "B") !== NATIONAL_IPC ||
    cell(6, "B") !== "Período" ||
    cell(6, "C") !== "Referencia" ||
    cell(6, "D") !== "Mediana"
  ) {
    return { ok: false, code: "header_changed" };
  }

  const forecasts: RemMonthlyForecast[] = [];
  const targets = new Set<string>();
  for (let row = 7; row <= 18; row += 1) {
    const reference = cell(row, "C");
    if (reference !== "var. % mensual") break;
    const targetMonth = excelMonth(cell(row, "B"));
    const medianPercent = cell(row, "D");
    if (
      targetMonth === null ||
      targets.has(targetMonth) ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(medianPercent) ||
      !Number.isFinite(Number(medianPercent))
    ) {
      return { ok: false, code: "forecast_invalid" };
    }
    targets.add(targetMonth);
    forecasts.push({ roundMonth, targetMonth, medianPercent });
  }
  if (forecasts.length < 1) return { ok: false, code: "forecasts_missing" };
  return { ok: true, forecasts };
}
