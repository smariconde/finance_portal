import { describe, expect, it } from "vitest";

import { bnaDivisasFixture } from "../infrastructure/fixture-soy-payloads";

import { bnaDivisasUrl, parseBnaDivisas } from "./bna-divisas-parser";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("bna-divisas-1.0.0", () => {
  it("reads one side, with trimmed zeros and padding as the cable sends them", () => {
    const text = decode(
      bnaDivisasFixture([
        ["11/1/2002", "1,4", "1,6"],
        ["18/1/2002", "1,85", "1,95    "],
        ["27/2/2013", "5,", "5,04"],
        ["3/11/2026", " 1542,0000", "1551,0000"],
      ]),
    );
    expect(parseBnaDivisas(text, "Dolar U.S.A", "buyer")).toEqual({
      ok: true,
      points: [
        { periodOn: "2002-01-11", value: "1.4" },
        { periodOn: "2002-01-18", value: "1.85" },
        { periodOn: "2013-02-27", value: "5" },
        { periodOn: "2026-11-03", value: "1542" },
      ],
    });
    const seller = parseBnaDivisas(text, "Dolar U.S.A", "seller");
    expect(seller.ok && seller.points[1]!.value).toBe("1.95");
  });

  it.each([
    [
      "a changed header",
      bnaDivisasFixture([], "Moneda;Fecha;Compra;Venta;"),
      "header_changed",
    ],
    ["no rows", bnaDivisasFixture([]), "empty"],
    [
      "an impossible date",
      bnaDivisasFixture([["31/2/2026", "1", "1"]]),
      "invalid_date",
    ],
    [
      "a zero quote",
      bnaDivisasFixture([["3/2/2026", "0,0000", "1"]]),
      "invalid_value",
    ],
    [
      "a dot decimal",
      bnaDivisasFixture([["3/2/2026", "1.5", "1"]]),
      "invalid_value",
    ],
    [
      "dates out of order",
      bnaDivisasFixture([
        ["4/2/2026", "1", "1"],
        ["3/2/2026", "1", "1"],
      ]),
      "unexpected_order",
    ],
  ] as const)("refuses %s by name", (_, bytes, reason) => {
    expect(parseBnaDivisas(decode(bytes), "Dolar U.S.A", "buyer")).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses a row of another currency or another shape", () => {
    const header = "Moneda;Fecha cotizacion;Compra;Venta;";
    expect(
      parseBnaDivisas(
        `${header}\nEuro;3/2/2026; 1; 1;\n`,
        "Dolar U.S.A",
        "buyer",
      ),
    ).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(
      parseBnaDivisas(
        `${header}\nDolar U.S.A;3/2/2026; 1; 1\n`,
        "Dolar U.S.A",
        "buyer",
      ),
    ).toEqual({ ok: false, reason: "row_shape" });
  });

  it("asks for a date range by currency code", () => {
    expect(bnaDivisasUrl("55", "2002-01-01", "2026-11-04")).toBe(
      "https://www.bna.com.ar/Cotizador/DescargarPorFecha?idMonedaDescarga=55&fechaDesde=01%2F01%2F2002&fechaHasta=04%2F11%2F2026&id=monedas",
    );
    expect(() => bnaDivisasUrl("55", "2002-1-1", "2026-11-04")).toThrow();
  });
});
