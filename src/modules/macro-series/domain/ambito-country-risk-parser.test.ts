import { describe, expect, it } from "vitest";

import {
  ambitoCountryRiskUrl,
  parseAmbitoCountryRisk,
} from "./ambito-country-risk-parser";

/** Synthetic: the shape measured on 2026-11-17, not a captured payload. */
function body(rows: readonly (readonly unknown[])[]): string {
  return JSON.stringify([["Fecha", "Puntos"], ...rows]);
}

describe("ambito-riesgo-pais-1.0.0", () => {
  it("reads closes newest first into points oldest first, from the text", () => {
    expect(
      parseAmbitoCountryRisk(
        body([
          ["03-01-2005", "4512,37"],
          ["31-12-2004", "4601,00"],
          ["30-12-2004", "987,10"],
        ]),
      ),
    ).toEqual({
      ok: true,
      points: [
        { periodOn: "2004-12-30", value: "987.1" },
        { periodOn: "2004-12-31", value: "4601" },
        { periodOn: "2005-01-03", value: "4512.37" },
      ],
      conflictingDays: [],
      weekendRows: 0,
    });
  });

  it("joins an identical copy and leaves a day with two values out by name", () => {
    const parsed = parseAmbitoCountryRisk(
      body([
        ["29-09-2022", "2754,00"],
        ["29-09-2022", "2754,00"],
        ["23-02-2021", "1490,00"],
        ["22-02-2021", "1509,00"],
        ["22-02-2021", "1501,00"],
        ["19-02-2021", "1480,00"],
      ]),
    );
    expect(parsed).toMatchObject({
      ok: true,
      conflictingDays: ["2021-02-22"],
    });
    expect(parsed.ok && parsed.points.map((point) => point.periodOn)).toEqual([
      "2021-02-19",
      "2021-02-23",
      "2022-09-29",
    ]);
  });

  it("keeps a weekend row as published and counts it", () => {
    const parsed = parseAmbitoCountryRisk(
      body([
        ["29-09-2025", "1115,00"],
        ["27-09-2025", "1060,00"],
        ["26-09-2025", "1060,00"],
      ]),
    );
    expect(parsed).toMatchObject({ ok: true, weekendRows: 1 });
    expect(parsed.ok && parsed.points).toHaveLength(3);
  });

  it.each([
    [
      "a changed header",
      JSON.stringify([
        ["Date", "Points"],
        ["01-02-2026", "1,00"],
      ]),
      "layout_changed",
    ],
    ["no rows", JSON.stringify([["Fecha", "Puntos"]]), "empty"],
    ["not JSON", "<html>", "invalid_json"],
    ["an object", JSON.stringify({ data: [] }), "layout_changed"],
    ["a third column", body([["01-02-2026", "800,00", "x"]]), "layout_changed"],
    ["a numeric cell", body([["01-02-2026", 800]]), "layout_changed"],
    ["an ISO date", body([["2026-02-01", "800,00"]]), "invalid_date"],
    ["an impossible date", body([["31-02-2026", "800,00"]]), "invalid_date"],
    [
      "a thousands separator",
      body([["01-02-2026", "1.800,00"]]),
      "invalid_value",
    ],
    ["a decimal point", body([["01-02-2026", "800.00"]]), "invalid_value"],
    ["a zero", body([["01-02-2026", "0,00"]]), "invalid_value"],
    ["a negative", body([["01-02-2026", "-5,00"]]), "invalid_value"],
    ["one decimal", body([["01-02-2026", "800,5"]]), "invalid_value"],
    [
      "oldest first",
      body([
        ["01-02-2026", "800,00"],
        ["02-02-2026", "810,00"],
      ]),
      "unexpected_order",
    ],
  ])("refuses %s by name", (_label, input, reason) => {
    expect(parseAmbitoCountryRisk(input)).toEqual({ ok: false, reason });
  });

  it("asks the whole history up to a day and nothing else", () => {
    expect(ambitoCountryRiskUrl("2026-11-17")).toBe(
      "https://mercados.ambito.com/riesgopais/historico-general/1990-01-01/2026-11-17",
    );
    expect(() => ambitoCountryRiskUrl("2026-11-17/../x")).toThrow();
  });
});
