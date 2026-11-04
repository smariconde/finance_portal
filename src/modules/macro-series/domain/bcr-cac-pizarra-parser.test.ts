import { describe, expect, it } from "vitest";

import { cacPizarraFixture } from "../infrastructure/fixture-soy-payloads";

import {
  cacPizarraExportUrl,
  parseCacPizarraExport,
} from "./bcr-cac-pizarra-parser";

describe("bcr-cac-pizarra-1.0.0", () => {
  it("reads days from the serial's whole part, whatever the load time", () => {
    const parsed = parseCacPizarraExport(
      cacPizarraFixture([
        ["36528.0", { n: "100.0" }],
        ["40358.441667", { n: "200.5" }],
        ["46324.125", { n: "300000.0" }],
      ]),
      "Soja",
    );
    expect(parsed).toEqual({
      ok: true,
      points: [
        { periodOn: "2000-01-03", value: "100" },
        { periodOn: "2010-06-29", value: "200.5" },
        { periodOn: "2026-10-29", value: "300000" },
      ],
    });
  });

  it("takes a double to centavos only when it is that close to them", () => {
    const parsed = parseCacPizarraExport(
      cacPizarraFixture([
        ["36528.0", { n: "176.099999999999994" }],
        ["36529.0", { n: "180.90000000000001" }],
      ]),
      "Soja",
    );
    expect(parsed.ok && parsed.points.map((point) => point.value)).toEqual([
      "176.1",
      "180.9",
    ]);
    expect(
      parseCacPizarraExport(
        cacPizarraFixture([["36528.0", { n: "176.123" }]]),
        "Soja",
      ),
    ).toEqual({ ok: false, reason: "price_not_in_cents" });
  });

  it("keeps a session without a price as a source null, never a zero", () => {
    const parsed = parseCacPizarraExport(
      cacPizarraFixture([
        ["46324.125", "S/C"],
        ["46325.125", { n: "542000.0" }],
      ]),
      "Soja",
    );
    expect(parsed.ok && parsed.points[0]).toEqual({
      periodOn: "2026-10-29",
      value: null,
    });
  });

  it.each([
    ["another text price", [["36528.0", "N/D"]], "invalid_price"],
    ["a zero price", [["36528.0", { n: "0" }]], "invalid_price"],
    ["a late fraction", [["36528.9", { n: "1" }]], "invalid_date"],
    [
      "a repeated day",
      [
        ["36528.0", { n: "1" }],
        ["36528.125", { n: "1" }],
      ],
      "unexpected_order",
    ],
  ] as const)("refuses %s by name", (_, rows, reason) => {
    expect(parseCacPizarraExport(cacPizarraFixture(rows), "Soja")).toEqual({
      ok: false,
      reason,
    });
  });

  it("checks the layout and the product before reading a row", () => {
    expect(
      parseCacPizarraExport(
        cacPizarraFixture([["36528.0", { n: "1" }]], { title: "Otra" }),
        "Soja",
      ),
    ).toEqual({ ok: false, reason: "layout_changed" });
    expect(
      parseCacPizarraExport(
        cacPizarraFixture([["36528.0", { n: "1" }]], { product: "Trigo" }),
        "Soja",
      ),
    ).toEqual({ ok: false, reason: "product_mismatch" });
    expect(parseCacPizarraExport(cacPizarraFixture([]), "Soja")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(
      parseCacPizarraExport(new TextEncoder().encode("<html>"), "Soja"),
    ).toEqual({ ok: false, reason: "unreadable_workbook" });
  });

  it("asks for the whole history up to a day", () => {
    expect(cacPizarraExportUrl("13", "2026-11-04")).toBe(
      "https://www.cac.bcr.com.ar/es/api/prices/987/export?product=13&type=pizarra&date_start=2000-01-01&date_end=2026-11-04&period=day",
    );
    expect(() => cacPizarraExportUrl("13&x=1", "2026-11-04")).toThrow();
  });
});
