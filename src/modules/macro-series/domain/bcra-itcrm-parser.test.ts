import { describe, expect, it } from "vitest";

import {
  buildXlsx,
  type CellFixture,
} from "@/modules/reference-data/infrastructure/fixture-xlsx";

import { parseBcraItcrmWorkbook } from "./bcra-itcrm-parser";

function book(
  options: {
    readonly header?: string;
    readonly badAt?: number;
    readonly duplicateAt?: number;
    readonly count?: number;
  } = {},
): Uint8Array {
  const count = options.count ?? 1_000;
  const rows: CellFixture[][] = [
    ["Índices con base 17-12-15=100"],
    ["Período", options.header ?? "ITCRM ", "ITCRB Brasil"],
    ...Array.from({ length: count }, (_, index): CellFixture[] => [
      {
        n: String(35_431 + (options.duplicateAt === index ? index - 1 : index)),
      },
      { n: options.badAt === index ? "#DIV/0!" : "86.348001144279905" },
      { n: "120" },
    ]),
    [null, null],
    ["Banco Central de la República Argentina"],
  ];
  return buildXlsx([{ name: "ITCRM y bilaterales", rows }]);
}

describe("bcra-itcrm-xlsx-1.0.0", () => {
  it("reads only the daily ITCRM and retains the source decimal", () => {
    const parsed = parseBcraItcrmWorkbook(book());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.points).toHaveLength(1_000);
    expect(parsed.points[0]).toEqual({
      on: "1997-01-01",
      value: "86.348001144279905",
    });
  });

  it("fails closed on a changed header, broken value, or duplicate date", () => {
    expect(parseBcraItcrmWorkbook(book({ header: "Otro índice" }))).toEqual({
      ok: false,
      code: "header_changed",
    });
    expect(parseBcraItcrmWorkbook(book({ badAt: 10 }))).toEqual({
      ok: false,
      code: "observation_invalid",
    });
    expect(parseBcraItcrmWorkbook(book({ duplicateAt: 10 }))).toEqual({
      ok: false,
      code: "observation_invalid",
    });
  });

  it("rejects a truncated history and an invalid workbook", () => {
    expect(parseBcraItcrmWorkbook(book({ count: 999 }))).toEqual({
      ok: false,
      code: "history_missing",
    });
    expect(parseBcraItcrmWorkbook(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      code: "xlsx_not_a_zip",
    });
  });
});
