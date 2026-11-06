import { describe, expect, it } from "vitest";

import {
  INDEC_IPIM_LEVEL_ROWS,
  INDEC_ICC_LEVEL_ROWS,
  INDEC_MANUFACTURING_LEVEL_ROWS,
  INDEC_MINING_LEVEL_ROWS,
  INDEC_WAGES_LEVEL_ROWS,
} from "../../../../tests/fixtures/indec-expanded-rows";

import { declaredArgentinaIndicator } from "./declared-argentina-indicators";
import { declaredIndecExpandedIndicator } from "./declared-indec-expanded-indicators";
import { indecPageUrl, parseIndecPage } from "./indec-api-parser";

const emae = declaredArgentinaIndicator("emae_sa")!;
const sector = declaredArgentinaIndicator("emae_sector_f")!;
const ipc = declaredIndecExpandedIndicator("ipc_nacional")!;
const basket = declaredIndecExpandedIndicator("basket_cba")!;
const manufacturing = declaredIndecExpandedIndicator("ipi_manufacturero_sa")!;
const mining = declaredIndecExpandedIndicator("ipi_minero_sa")!;
const wholesale = declaredIndecExpandedIndicator("sipm_ipim_general")!;
const construction = declaredIndecExpandedIndicator("icc_gba_general")!;
const wages = declaredIndecExpandedIndicator("wages_general")!;

function expandedRow(
  indicator: typeof ipc,
  period: string,
  value: string | null,
  overrides: Record<string, unknown> = {},
): string {
  const fields: Record<string, unknown> = {
    ...indicator.filters,
    periodo: period,
    anio: Number(period.slice(0, 4)),
    mes: Number(period.slice(4)),
    valor: "__RAW_VALUE__",
    valor_null: value === null ? "///" : null,
    observaciones: null,
    ...overrides,
  };
  return JSON.stringify(fields).replace(
    '"valor":"__RAW_VALUE__"',
    `"valor":${value ?? "null"}`,
  );
}

/** Synthetic rows with the general-level service's columns. */
function row(
  periodo: string,
  valor: string | null,
  overrides: Record<string, string | null> = {},
): string {
  const fields: Record<string, string> = {
    tipo_de_indicador_descripcion: JSON.stringify(
      "Índice serie desestacionalizada",
    ),
    anio: String(Number(periodo.slice(0, 4))),
    mes: String(Number(periodo.slice(4))),
    periodo: JSON.stringify(periodo),
    tipo_de_indicador: JSON.stringify("Índice base 2004=100"),
    valor: valor ?? "null",
    valor_null: "null",
    observaciones: "null",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete fields[key];
    else fields[key] = value;
  }
  return `{${Object.entries(fields)
    .map(([key, value]) => `${JSON.stringify(key)}:${value}`)
    .join(",")}}`;
}

const page = (...rows: string[]) => `[${rows.join(",")}]`;

describe("parseIndecPage", () => {
  it("accepts independent synthetic fixtures for the observed IPI and SIPM wires", () => {
    for (const [indicator, rows] of [
      [manufacturing, INDEC_MANUFACTURING_LEVEL_ROWS],
      [mining, INDEC_MINING_LEVEL_ROWS],
      [wholesale, INDEC_IPIM_LEVEL_ROWS],
      [construction, INDEC_ICC_LEVEL_ROWS],
      [wages, INDEC_WAGES_LEVEL_ROWS],
    ] as const) {
      const parsed = parseIndecPage(JSON.stringify(rows), indicator);
      expect(parsed).toMatchObject({
        ok: true,
        points: [
          { periodOn: "2026-07-01", value: "100" },
          { periodOn: "2026-08-01", value: "102" },
        ],
      });
    }
  });

  it("keeps an early salary null with its published conventional sign", () => {
    const row = {
      ...INDEC_WAGES_LEVEL_ROWS[0],
      periodo: "201510",
      anio: 2015,
      mes: 10,
      valor: null,
      valor_null: "///",
    };
    expect(parseIndecPage(JSON.stringify([row]), wages)).toEqual({
      ok: true,
      points: [{ periodOn: "2015-10-01", value: null, note: "///" }],
    });
  });
  it("reads the three new service shapes and normalizes SIPM's provisional note", () => {
    const row = (indicator: typeof ipc, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        ...indicator.filters,
        periodo: "202608",
        anio: 2026,
        mes: 8,
        valor: 123.45,
        valor_null: null,
        ...(indicator.externalId === "sipm_precios_mayoristas"
          ? { observaciones: "* Dato provisorio" }
          : {}),
        ...extra,
      });
    for (const indicator of [manufacturing, mining]) {
      expect(parseIndecPage(`[${row(indicator)}]`, indicator)).toEqual({
        ok: true,
        points: [{ periodOn: "2026-08-01", value: "123.45", note: null }],
      });
    }
    expect(parseIndecPage(`[${row(wholesale)}]`, wholesale)).toEqual({
      ok: true,
      points: [{ periodOn: "2026-08-01", value: "123.45", note: "*" }],
    });
    expect(
      parseIndecPage(
        `[${row(wholesale, { observaciones: "otra nota" })}]`,
        wholesale,
      ),
    ).toEqual({ ok: false, reason: "unknown_note" });
  });

  it("refuses a wrong IPI code, missing column and non-positive SIPM level", () => {
    const row = (indicator: typeof ipc, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        ...indicator.filters,
        periodo: "202608",
        anio: 2026,
        mes: 8,
        valor: 123,
        valor_null: null,
        ...(indicator.externalId === "sipm_precios_mayoristas"
          ? { observaciones: null }
          : {}),
        ...extra,
      });
    expect(
      parseIndecPage(
        `[${row(manufacturing, { codigo_CLaNAE_2004: "X" })}]`,
        manufacturing,
      ),
    ).toEqual({ ok: false, reason: "filter_mismatch" });
    expect(
      parseIndecPage(`[${row(mining, { observaciones: null })}]`, mining),
    ).toEqual({ ok: false, reason: "schema_changed" });
    expect(
      parseIndecPage(`[${row(wholesale, { valor: 0 })}]`, wholesale),
    ).toEqual({ ok: false, reason: "invalid_value" });
  });
  it("reads the declared IPC and basket wire shapes without losing decimal digits", () => {
    expect(
      parseIndecPage(
        page(
          expandedRow(ipc, "202608", "12276.766"),
          expandedRow(ipc, "202609", "12514.1508000001"),
        ),
        ipc,
      ),
    ).toEqual({
      ok: true,
      points: [
        { periodOn: "2026-08-01", value: "12276.766", note: null },
        { periodOn: "2026-09-01", value: "12514.1508000001", note: null },
      ],
    });
    expect(
      parseIndecPage(page(expandedRow(basket, "202609", "239058.22")), basket),
    ).toEqual({
      ok: true,
      points: [{ periodOn: "2026-09-01", value: "239058.22", note: null }],
    });
  });

  it("rejects a changed IPC region, extra basket column and unexplained null", () => {
    expect(
      parseIndecPage(
        page(expandedRow(ipc, "202609", "12514", { region: "GBA" })),
        ipc,
      ),
    ).toEqual({ ok: false, reason: "filter_mismatch" });
    expect(
      parseIndecPage(
        page(expandedRow(basket, "202609", "239058", { extra: "x" })),
        basket,
      ),
    ).toEqual({ ok: false, reason: "schema_changed" });
    expect(
      parseIndecPage(
        page(expandedRow(basket, "202609", null, { valor_null: null })),
        basket,
      ),
    ).toEqual({ ok: false, reason: "invalid_value" });
  });

  it("refuses non-positive IPC and basket history, but keeps a negative published rate", () => {
    for (const indicator of [ipc, basket]) {
      for (const value of ["0", "-1"]) {
        expect(
          parseIndecPage(
            page(expandedRow(indicator, "202601", value)),
            indicator,
          ),
        ).toEqual({ ok: false, reason: "invalid_value" });
      }
    }
    const rate = {
      ...ipc,
      filters: {
        ...ipc.filters,
        tipo_de_indicador: "v_m",
        tipo_de_indicador_descripcion:
          "Variación porcentual respecto del período anterior",
        unidad_de_medida: "Porcentaje",
      },
    };
    expect(
      parseIndecPage(page(expandedRow(rate, "202601", "-0.2")), rate),
    ).toEqual({
      ok: true,
      points: [{ periodOn: "2026-01-01", value: "-0.2", note: null }],
    });
  });

  it("keeps every digit the source printed and orders by period", () => {
    const parsed = parseIndecPage(
      page(row("202602", "101.10000000000001"), row("202601", "100.5")),
      emae,
    );
    expect(parsed).toEqual({
      ok: true,
      points: [
        { periodOn: "2026-01-01", value: "100.5", note: null },
        { periodOn: "2026-02-01", value: "101.10000000000001", note: null },
      ],
    });
  });

  it("carries a conventional sign with a missing or a provisional value", () => {
    const parsed = parseIndecPage(
      page(
        row("202601", null, { valor_null: '"///"' }),
        row("202602", "100", { observaciones: '"*"' }),
      ),
      emae,
    );
    expect(parsed).toMatchObject({
      ok: true,
      points: [
        { value: null, note: "///" },
        { value: "100", note: "*" },
      ],
    });
  });

  it.each([
    ["a missing value without a sign", row("202601", null), "invalid_value"],
    [
      "a value next to a null sign",
      row("202601", "1", { valor_null: '"s"' }),
      "invalid_value",
    ],
    [
      "a note outside the conventional signs",
      row("202601", "1", { observaciones: '"Dato revisado"' }),
      "unknown_note",
    ],
    [
      "a column the service lost",
      row("202601", "1", { valor_null: null }),
      "schema_changed",
    ],
    [
      "a column the service gained",
      row("202601", "1", { unidad: '"x"' }),
      "schema_changed",
    ],
    [
      "a row from another series",
      row("202601", "1", {
        tipo_de_indicador_descripcion: '"Índice serie original"',
      }),
      "filter_mismatch",
    ],
    [
      "a period that disagrees with its year and month",
      row("202601", "1", { mes: "2" }),
      "period_mismatch",
    ],
    ["a string where a number goes", row("202601", '"1"'), "invalid_value"],
  ])("refuses %s", (_label, body, reason) => {
    expect(parseIndecPage(page(body), emae)).toEqual({ ok: false, reason });
  });

  it("refuses a repeated period and an API error envelope", () => {
    expect(
      parseIndecPage(page(row("202601", "1"), row("202601", "2")), emae),
    ).toEqual({ ok: false, reason: "duplicate_period" });
    expect(
      parseIndecPage(
        '{"code":"PGRST100","message":"failed to parse filter","details":null,"hint":null}',
        emae,
      ),
    ).toEqual({ ok: false, reason: "api_error" });
    expect(parseIndecPage("<html>", emae)).toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});

describe("indecPageUrl", () => {
  it("filters by every declared column and orders by the full key", () => {
    expect(indecPageUrl(sector, 1000)).toBe(
      "https://api.indec.gob.ar/v1/estimador-mensual-de-actividad-economica-sectores" +
        "?codigo=eq.F&descripcion=eq.Construcci%C3%B3n" +
        "&tipo_de_indicador=eq.%C3%8Dndice%20base%202004%3D100" +
        "&order=anio,mes,codigo,descripcion,periodo,tipo_de_indicador" +
        "&limit=1000&offset=1000",
    );
  });

  it("refuses a negative offset", () => {
    expect(() => indecPageUrl(emae, -1)).toThrow("invalid_indec_offset");
  });
});
