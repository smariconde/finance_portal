import { describe, expect, it } from "vitest";

import {
  finvizStrategyFormSchema,
  sameStrategyFields,
  strategyFieldsOf,
  strategySelection,
} from "./finviz-screener-strategy";

const form = {
  strategyId: null,
  baseRevision: null,
  name: "  Semis   baratos ",
  view: "111",
  signal: "ta_newhigh",
  filters: { ta_rsi: "os30", industry: "semiconductors" },
};

describe("finviz screener strategy", () => {
  it("normalizes the name and stores the canonical query", () => {
    const parsed = finvizStrategyFormSchema.parse(form);
    expect(strategyFieldsOf(parsed)).toEqual({
      name: "Semis baratos",
      view: "111",
      signal: "ta_newhigh",
      filters: "industry_semiconductors,ta_rsi_os30",
    });
  });

  it("refuses names, views, signals and options outside the catalog", () => {
    for (const bad of [
      { ...form, name: "   " },
      { ...form, name: "x".repeat(81) },
      { ...form, view: "210" },
      { ...form, signal: "f_halted" },
      { ...form, filters: { cap: "frange" } },
      { ...form, filters: { exch: "nasd|nyse" } },
      { ...form, filters: { zz: "x" } },
      { ...form, url: "https://finviz.com" },
    ])
      expect(finvizStrategyFormSchema.safeParse(bad).success).toBe(false);
  });

  it("compares fields and reads a stored query against the catalog", () => {
    const fields = strategyFieldsOf(finvizStrategyFormSchema.parse(form));
    expect(sameStrategyFields(fields, { ...fields })).toBe(true);
    expect(sameStrategyFields(fields, { ...fields, view: "211" })).toBe(false);
    expect(
      strategySelection({
        ...fields,
        filters: "industry_semiconductors,cap_gone",
      }),
    ).toEqual({
      selection: {
        view: "111",
        signal: "ta_newhigh",
        filters: { industry: "semiconductors" },
      },
      dropped: [{ token: "cap_gone", reason: "unknown_option" }],
      catalogChanged: false,
    });
  });
});
