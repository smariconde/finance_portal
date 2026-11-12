import { describe, expect, it } from "vitest";

import {
  buildXlsx,
  type CellFixture,
} from "@/modules/reference-data/infrastructure/fixture-xlsx";

import { parseBcraRemReleaseWorkbook } from "./bcra-rem-release-parser";

function book(
  options: {
    readonly title?: string;
    readonly label?: string;
    readonly target?: string;
    readonly median?: string;
    readonly duplicate?: boolean;
  } = {},
): Uint8Array {
  const rows: CellFixture[][] = [
    [],
    [
      null,
      options.title ??
        "Relevamiento de Expectativas de Mercado (REM)  - BCRA - Octubre 2026",
    ],
    [],
    [],
    [
      null,
      options.label ?? "Precios minoristas (IPC nivel general-Nacional; INDEC)",
    ],
    [null, "Período", "Referencia", "Mediana"],
    [
      null,
      { n: options.target ?? "46326" },
      "var. % mensual",
      { n: options.median ?? "1.8" },
    ],
    [
      null,
      { n: options.duplicate ? "46326" : "46356" },
      "var. % mensual",
      { n: "-0.25" },
    ],
    [null, "próx. 12 meses", "var. % i.a.; oct-27", { n: "20" }],
  ];
  return buildXlsx([{ name: "Cuadros de resultados", rows }]);
}

describe("bcra-rem-release-xlsx-1.0.0", () => {
  it("keeps the round separate from its target months and preserves percentages", () => {
    expect(parseBcraRemReleaseWorkbook(book(), "2026-10")).toEqual({
      ok: true,
      forecasts: [
        { roundMonth: "2026-10", targetMonth: "2026-10", medianPercent: "1.8" },
        {
          roundMonth: "2026-10",
          targetMonth: "2026-11",
          medianPercent: "-0.25",
        },
      ],
    });
  });

  it("rejects a wrong edition, changed IPC scope, duplicate target and malformed value", () => {
    for (const [bytes, code] of [
      [book({ title: "REM Septiembre 2026" }), "header_changed"],
      [book({ label: "IPC GBA" }), "header_changed"],
      [book({ duplicate: true }), "forecast_invalid"],
      [book({ median: "#DIV/0!" }), "forecast_invalid"],
      [book({ target: "46325" }), "forecast_invalid"],
    ] as const) {
      expect(parseBcraRemReleaseWorkbook(bytes, "2026-10")).toEqual({
        ok: false,
        code,
      });
    }
  });

  it("rejects an invalid round and workbook", () => {
    expect(parseBcraRemReleaseWorkbook(book(), "2026-13")).toEqual({
      ok: false,
      code: "round_invalid",
    });
    expect(
      parseBcraRemReleaseWorkbook(new Uint8Array([1, 2]), "2026-10"),
    ).toEqual({ ok: false, code: "xlsx_not_a_zip" });
  });
});
