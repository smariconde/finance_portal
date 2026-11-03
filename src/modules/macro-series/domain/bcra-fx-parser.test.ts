import { describe, expect, it } from "vitest";

import {
  fixtureFxCurrencies,
  fixtureFxDays,
  fixtureFxQuotesPage,
  fxWireNumber,
} from "../infrastructure/fixture-bcra-fx-payloads";

import {
  assembleFxPages,
  parseFxCurrencies,
  parseFxQuotesPage,
} from "./bcra-fx-parser";
import { buenosAiresDate, fxQuotesUrl } from "./bcra-fx-source";

const input = {
  httpStatus: 200,
  isoCode: "USD",
  isoNumeric: 840,
  offset: 0,
};

describe("parseFxQuotesPage", () => {
  it("reads each day's quote exactly from the source text", () => {
    const page = parseFxQuotesPage(
      fixtureFxQuotesPage(
        "USD",
        [
          { fecha: "2026-11-02", quotes: ["1545.50000000"] },
          { fecha: "2026-10-30", quotes: ["0.10000001"] },
        ],
        0,
      ),
      input,
    );

    expect(page).toEqual({
      ok: true,
      total: 2,
      offset: 0,
      rows: [
        { periodOn: "2026-11-02", value: "1545.5" },
        { periodOn: "2026-10-30", value: "0.10000001" },
      ],
      rejections: [],
      consumed: 2,
    });
  });

  it("collapses identical copies of a day and rejects a day with two values", () => {
    const page = parseFxQuotesPage(
      fixtureFxQuotesPage(
        "USD",
        [
          {
            fecha: "2017-09-07",
            quotes: [fxWireNumber("17.3"), fxWireNumber("17.3")],
          },
          {
            fecha: "2017-09-06",
            quotes: [fxWireNumber("37.35"), fxWireNumber("17.215")],
          },
        ],
        0,
      ),
      input,
    );

    expect(page.ok && page.rows).toEqual([
      { periodOn: "2017-09-07", value: "17.3" },
    ]);
    expect(page.ok && page.rejections).toEqual([
      {
        row: 1,
        variableId: 840,
        field: "tipoCotizacion",
        periodOn: "2017-09-06",
      },
    ]);
  });

  it("rejects a zero or negative quote by name, never as a value", () => {
    const page = parseFxQuotesPage(
      fixtureFxQuotesPage(
        "USD",
        [
          { fecha: "2026-11-02", quotes: ["0.00000000"] },
          { fecha: "2026-10-30", quotes: ["-1.00000000"] },
        ],
        0,
      ),
      input,
    );

    expect(page.ok && page.rows).toEqual([]);
    expect(page.ok && page.rejections.map((row) => row.periodOn)).toEqual([
      "2026-11-02",
      "2026-10-30",
    ]);
  });

  it("refuses the whole page when the cable changes", () => {
    const valid = fixtureFxQuotesPage("USD", fixtureFxDays("2026-11-02", 3), 0);

    for (const [body, code] of [
      ["{", "invalid_json"],
      [valid.replace('"metadata"', '"meta"'), "envelope_schema_changed"],
      [valid.replace('"descripcion"', '"nombre"'), "row_schema_changed"],
      [valid.replaceAll('"USD"', '"EUR"'), "series_id_mismatch"],
      [valid.replace('"offset":0', '"offset":5'), "offset_mismatch"],
      [valid.replace('"count":3', '"count":9'), "page_size_mismatch"],
    ] as const) {
      expect(parseFxQuotesPage(body, input)).toEqual({ ok: false, code });
    }
  });

  it("refuses dates that are not strictly descending", () => {
    const body = fixtureFxQuotesPage(
      "USD",
      [
        { fecha: "2026-10-30", quotes: ["1.00000000"] },
        { fecha: "2026-11-02", quotes: ["1.00000000"] },
      ],
      0,
    );

    expect(parseFxQuotesPage(body, input)).toEqual({
      ok: false,
      code: "unexpected_order",
    });
  });
});

describe("assembleFxPages", () => {
  const parse = (body: string, offset: number) => {
    const page = parseFxQuotesPage(body, { ...input, offset });

    if (!page.ok) {
      throw new Error(page.code);
    }

    return page;
  };

  // 999 días de una cotización y uno con dos copias: la segunda copia cae en
  // la página siguiente.
  const days = (copies: readonly string[]) => [
    ...fixtureFxDays("2026-11-02", 999),
    { fecha: "2024-01-01", quotes: copies },
    { fecha: "2023-12-29", quotes: [fxWireNumber("1")] },
  ];

  it("joins a day whose copies straddle a page boundary", () => {
    const all = days([fxWireNumber("5"), fxWireNumber("5")]);
    const pages = [
      parse(fixtureFxQuotesPage("USD", all, 0), 0),
      parse(fixtureFxQuotesPage("USD", all, 1000), 1000),
    ];
    const assembled = assembleFxPages(pages, "complete");

    expect(assembled.ok && assembled.rows.length).toBe(1001);
    expect(assembled.ok && assembled.rows.at(-2)).toEqual({
      periodOn: "2024-01-01",
      value: "5",
    });
    expect(assembled.ok && assembled.complete).toBe(true);
  });

  it("rejects a straddling day whose copies disagree", () => {
    const all = days([fxWireNumber("5"), fxWireNumber("6")]);
    const assembled = assembleFxPages(
      [
        parse(fixtureFxQuotesPage("USD", all, 0), 0),
        parse(fixtureFxQuotesPage("USD", all, 1000), 1000),
      ],
      "complete",
    );

    expect(assembled.ok && assembled.rejections.map((r) => r.periodOn)).toEqual(
      ["2024-01-01"],
    );
  });

  it("leaves out the last day of a full window page, which may continue", () => {
    const all = days([fxWireNumber("5"), fxWireNumber("6")]);
    const assembled = assembleFxPages(
      [parse(fixtureFxQuotesPage("USD", all, 0), 0)],
      "window",
    );

    expect(assembled.ok && assembled.complete).toBe(false);
    expect(assembled.ok && assembled.rows.length).toBe(999);
    expect(assembled.ok && assembled.rejections).toEqual([]);
  });
});

describe("parseFxCurrencies", () => {
  it("reads the currency master", () => {
    expect(
      parseFxCurrencies(
        fixtureFxCurrencies([
          { codigo: "USD", denominacion: "DOLAR SINTÉTICO" },
          { codigo: "EUR", denominacion: "EURO  SINTÉTICO" },
        ]),
        200,
      ),
    ).toEqual({
      ok: true,
      currencies: [
        { isoCode: "USD", name: "DOLAR SINTÉTICO" },
        { isoCode: "EUR", name: "EURO SINTÉTICO" },
      ],
      ambiguous: [],
    });
  });

  it("leaves a code with two names ambiguous and keeps an identical repeat", () => {
    expect(
      parseFxCurrencies(
        fixtureFxCurrencies([
          { codigo: "NIO", denominacion: "CORDOBA" },
          { codigo: "NIO", denominacion: "CORDOBAS" },
          { codigo: "USD", denominacion: "DOLAR" },
          { codigo: "USD", denominacion: "DOLAR" },
        ]),
        200,
      ),
    ).toEqual({
      ok: true,
      currencies: [{ isoCode: "USD", name: "DOLAR" }],
      ambiguous: ["NIO"],
    });
  });

  it("refuses a malformed code", () => {
    expect(
      parseFxCurrencies(
        fixtureFxCurrencies([{ codigo: "usd", denominacion: "A" }]),
        200,
      ),
    ).toEqual({ ok: false, code: "row_schema_changed" });
  });
});

describe("fxQuotesUrl", () => {
  it("asks up to Buenos Aires' day, which the API calls today", () => {
    // 01:30 UTC del 3 es todavía el 2 en Buenos Aires.
    expect(buenosAiresDate("2026-11-03T01:30:00.000Z")).toBe("2026-11-02");
    expect(fxQuotesUrl("USD", 1000, "2026-11-02")).toBe(
      "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=1992-01-02&fechahasta=2026-11-02&limit=1000&offset=1000",
    );
  });
});
