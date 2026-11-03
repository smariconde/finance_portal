import { describe, expect, it } from "vitest";

import {
  fixtureCatalogPage,
  fixtureDailyPoints,
  fixtureMethodologyPage,
  fixtureSeriesPage,
  wireNumber,
  type FixtureCatalogRow,
} from "../infrastructure/fixture-bcra-payloads";

import {
  assemblePages,
  parseCatalogPage,
  parseMethodologyPage,
  parseSeriesPage,
  seriesPagesInOrder,
} from "./bcra-monetary-parser";

const rows = (count: number): FixtureCatalogRow[] =>
  Array.from({ length: count }, (_, index) => ({ idVariable: index + 1 }));

describe("parseCatalogPage", () => {
  it("reads the catalog's count as what remains from the offset", () => {
    const all = rows(1200);
    const first = parseCatalogPage(fixtureCatalogPage(all, 0), {
      httpStatus: 200,
      offset: 0,
    });
    const second = parseCatalogPage(fixtureCatalogPage(all, 1000), {
      httpStatus: 200,
      offset: 1000,
    });

    expect(first.ok && first.total).toBe(1200);
    expect(first.ok && first.rows).toHaveLength(1000);
    expect(second.ok && second.total).toBe(1200);
    expect(second.ok && second.rows).toHaveLength(200);
  });

  it("normalizes the definition and keeps the volatile fields apart", () => {
    const page = parseCatalogPage(
      fixtureCatalogPage(
        [
          {
            idVariable: 8,
            descripcion: "Tasa de interés TM20 de bancos privados ",
            periodicidad: "M",
            moneda: "MEyML",
            unidadExpresion: "En  porcentaje nominal anual",
            ultFechaInformada: "2026-10-30",
            ultValorInformado: "22.75000000000",
          },
        ],
        0,
      ),
      { httpStatus: 200, offset: 0 },
    );

    expect(page.ok && page.rows[0]).toEqual({
      variableId: 8,
      description: "Tasa de interés TM20 de bancos privados",
      category: "Principales Variables",
      seriesType: "Saldos",
      frequency: "monthly",
      unit: "En porcentaje nominal anual",
      currencyCode: "MEyML",
      firstReportedOn: "2020-01-02",
      lastReportedOn: "2026-10-30",
      lastReportedValue: "22.75",
    });
  });

  it("maps both quarterly codes of the manual", () => {
    for (const periodicidad of ["T", "Q"]) {
      const page = parseCatalogPage(
        fixtureCatalogPage([{ idVariable: 1, periodicidad }], 0),
        { httpStatus: 200, offset: 0 },
      );

      expect(page.ok && page.rows[0]!.frequency).toBe("quarterly");
    }
  });

  it("rejects a row with an unknown vocabulary by field, never by value", () => {
    const page = parseCatalogPage(
      fixtureCatalogPage(
        [
          { idVariable: 1, moneda: "EUR" },
          { idVariable: 2, periodicidad: "S" },
          { idVariable: 3, primerFechaInformada: "02/01/2020" },
          { idVariable: 4 },
        ],
        0,
      ),
      { httpStatus: 200, offset: 0 },
    );

    expect(page.ok && page.rows.map((row) => row.variableId)).toEqual([4]);
    expect(page.ok && page.rejections).toEqual([
      { row: 0, variableId: 1, field: "moneda" },
      { row: 1, variableId: 2, field: "periodicidad" },
      { row: 2, variableId: 3, field: "primerFechaInformada" },
    ]);
  });

  it("accepts a variable the catalog has no last value for", () => {
    const page = parseCatalogPage(
      fixtureCatalogPage(
        [{ idVariable: 1, ultFechaInformada: null, ultValorInformado: null }],
        0,
      ),
      { httpStatus: 200, offset: 0 },
    );

    expect(page.ok && page.rows[0]!.lastReportedValue).toBeNull();
  });

  it("refuses the whole page when a row gains or loses a key", () => {
    const body = fixtureCatalogPage(rows(2), 0);

    expect(
      parseCatalogPage(
        body.replace('"moneda":"ML",', '"moneda":"ML","isin":"x",'),
        {
          httpStatus: 200,
          offset: 0,
        },
      ),
    ).toEqual({ ok: false, code: "row_schema_changed" });
    expect(
      parseCatalogPage(body.replace('"moneda":"ML",', ""), {
        httpStatus: 200,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "row_schema_changed" });
  });

  it("refuses a changed envelope, a status that disagrees and a broken body", () => {
    const body = fixtureCatalogPage(rows(2), 0);

    expect(
      parseCatalogPage(body.replace('"metadata"', '"meta"'), {
        httpStatus: 200,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "envelope_schema_changed" });
    expect(parseCatalogPage(body, { httpStatus: 203, offset: 0 })).toEqual({
      ok: false,
      code: "status_mismatch",
    });
    expect(parseCatalogPage("{", { httpStatus: 200, offset: 0 })).toEqual({
      ok: false,
      code: "invalid_json",
    });
    expect(
      parseCatalogPage(new Uint8Array([0xff, 0xfe]), {
        httpStatus: 200,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "invalid_json" });
  });

  it("refuses a truncated page and an offset it did not ask for", () => {
    const body = fixtureCatalogPage(rows(3), 0);

    expect(
      parseCatalogPage(body.replace('"count":3', '"count":4'), {
        httpStatus: 200,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "page_size_mismatch" });
    expect(parseCatalogPage(body, { httpStatus: 200, offset: 1000 })).toEqual({
      ok: false,
      code: "offset_mismatch",
    });
    expect(
      parseCatalogPage(body.replace('"limit":1000', '"limit":500'), {
        httpStatus: 200,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "limit_mismatch" });
  });

  it("refuses a repeated variable", () => {
    expect(
      parseCatalogPage(
        fixtureCatalogPage([{ idVariable: 7 }, { idVariable: 7 }], 0),
        { httpStatus: 200, offset: 0 },
      ),
    ).toEqual({ ok: false, code: "duplicate_key" });
  });
});

describe("parseMethodologyPage", () => {
  it("reads its count as the total and keeps an empty text as null", () => {
    const all = [
      { id: 1, detalle: "  Saldo diario  de reservas. " },
      { id: 2, detalle: "" },
      { id: 3, detalle: null },
    ];
    const page = parseMethodologyPage(fixtureMethodologyPage(all, 0), {
      httpStatus: 200,
      offset: 0,
    });

    expect(page.ok && page.total).toBe(3);
    expect(page.ok && page.rows).toEqual([
      { variableId: 1, text: "Saldo diario de reservas." },
      { variableId: 2, text: null },
      { variableId: 3, text: null },
    ]);
  });
});

describe("parseSeriesPage", () => {
  it("reads values from the source text, never through a double", () => {
    const page = parseSeriesPage(
      fixtureSeriesPage(
        30,
        [
          { fecha: "2026-11-15", valor: "12345678901234567.12345678901" },
          { fecha: "2026-11-14", valor: wireNumber("-0.3") },
          { fecha: "2026-11-13", valor: "0.00000000000" },
        ],
        0,
      ),
      { httpStatus: 200, variableId: 30, offset: 0 },
    );

    expect(page.ok && page.rows).toEqual([
      { periodOn: "2026-11-15", value: "12345678901234567.12345678901" },
      { periodOn: "2026-11-14", value: "-0.3" },
      { periodOn: "2026-11-13", value: "0" },
    ]);
  });

  it("rejects a null value with its date instead of writing a zero", () => {
    const page = parseSeriesPage(
      fixtureSeriesPage(
        1,
        [
          { fecha: "2026-10-29", valor: wireNumber("50164") },
          { fecha: "2026-10-28", valor: null },
        ],
        0,
      ),
      { httpStatus: 200, variableId: 1, offset: 0 },
    );

    expect(page.ok && page.rows).toHaveLength(1);
    expect(page.ok && page.rejections).toEqual([
      { row: 1, variableId: 1, field: "valor", periodOn: "2026-10-28" },
    ]);
  });

  it("refuses ascending or repeated dates, because the window is the latest page", () => {
    const ascending = [
      { fecha: "2026-10-28", valor: wireNumber("1") },
      { fecha: "2026-10-29", valor: wireNumber("2") },
    ];
    const repeated = [
      { fecha: "2026-10-29", valor: wireNumber("1") },
      { fecha: "2026-10-29", valor: wireNumber("2") },
    ];

    expect(
      parseSeriesPage(fixtureSeriesPage(1, ascending, 0), {
        httpStatus: 200,
        variableId: 1,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "unexpected_order" });
    expect(
      parseSeriesPage(fixtureSeriesPage(1, repeated, 0), {
        httpStatus: 200,
        variableId: 1,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "duplicate_key" });
  });

  it("refuses another variable's series and a point with another shape", () => {
    const body = fixtureSeriesPage(1, fixtureDailyPoints("2026-10-29", 2), 0);

    expect(
      parseSeriesPage(body, { httpStatus: 200, variableId: 4, offset: 0 }),
    ).toEqual({ ok: false, code: "series_id_mismatch" });
    expect(
      parseSeriesPage(body.replace('"valor":', '"value":'), {
        httpStatus: 200,
        variableId: 1,
        offset: 0,
      }),
    ).toEqual({ ok: false, code: "row_schema_changed" });
  });
});

describe("assemblePages", () => {
  const points = fixtureDailyPoints("2026-11-15", 3500);
  const page = (offset: number) => {
    const parsed = parseSeriesPage(fixtureSeriesPage(30, points, offset), {
      httpStatus: 200,
      variableId: 30,
      offset,
    });

    if (!parsed.ok) {
      throw new Error(parsed.code);
    }

    return parsed;
  };

  it("needs every page for a complete resource and only the first for a window", () => {
    const first = page(0);
    const second = page(3000);

    expect(
      assemblePages([first, second], (row) => row.periodOn, "complete"),
    ).toMatchObject({ ok: true, total: 3500 });
    expect(assemblePages([first], (row) => row.periodOn, "complete")).toEqual({
      ok: false,
      code: "page_size_mismatch",
    });
    expect(
      assemblePages([first], (row) => row.periodOn, "window"),
    ).toMatchObject({ ok: true, total: 3500 });
    expect(seriesPagesInOrder([first, second])).toBe(true);
    expect(seriesPagesInOrder([second, first])).toBe(false);
  });

  it("refuses pages whose total changed in the middle of the download", () => {
    const first = page(0);
    const shifted = { ...page(3000), total: 3501 };

    expect(
      assemblePages([first, shifted], (row) => row.periodOn, "complete"),
    ).toEqual({ ok: false, code: "total_changed" });
  });
});
