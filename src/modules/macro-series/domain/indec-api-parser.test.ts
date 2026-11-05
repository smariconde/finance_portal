import { describe, expect, it } from "vitest";

import { declaredArgentinaIndicator } from "./declared-argentina-indicators";
import { declaredIndecExpandedIndicator } from "./declared-indec-expanded-indicators";
import { indecPageUrl, parseIndecPage } from "./indec-api-parser";

const emae = declaredArgentinaIndicator("emae_sa")!;
const sector = declaredArgentinaIndicator("emae_sector_f")!;
const ipc = declaredIndecExpandedIndicator("ipc_nacional")!;
const basket = declaredIndecExpandedIndicator("basket_cba")!;

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
