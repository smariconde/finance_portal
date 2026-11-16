import { describe, expect, it } from "vitest";

import { readFinvizScreenerPage } from "./finviz-screener-page";

/** Página sintética con la forma medida el 2026-11-16: no es contenido de Finviz. */
function page(filters: unknown[], extra: Record<string, unknown> = {}) {
  const props = {
    url: "/screener/stocks?v=111&ft=4",
    today: "2026-11-16T09:08:28",
    settings: {
      screenerVersion: 41,
      screenerFiltersVersion: "00aa11bb22cc33dd",
    },
    filters: { filters, tabOrder: {} },
    ...extra,
  };
  return `<html><body><script type="application/json" data-ssr-props="ssr-island-9">{"other":true}</script>
<script type="application/json" data-ssr-props="ssr-island-1">${JSON.stringify(props)}</script></body></html>`;
}

const base = {
  tab: "descriptive",
  uiType: "modalSelect",
  title: {
    short: "Sector",
    full: "Sector",
    description: "Sector<br>de la empresa.",
  },
  screenerTypes: ["stocks"],
};

const sector = {
  ...base,
  key: "sec",
  options: [
    { value: "", label: "Any" },
    { value: "technology", label: "Technology" },
    { value: "energy", label: "Energy" },
    { value: "modal", label: "Custom", isEliteOnly: true },
  ],
};

describe("finviz screener page", () => {
  it("keeps free options, names the elite ones and resolves groups", () => {
    const reading = readFinvizScreenerPage(
      page([
        sector,
        {
          ...base,
          key: "industry",
          title: { short: "Industry", full: "Industry", description: "" },
          options: [
            { value: "", label: "Any" },
            {
              value: "semiconductors",
              label: "Semiconductors",
              group: "technology",
            },
            { value: "oilgasep", label: "Oil & Gas E&P", group: "energy" },
          ],
        },
        {
          ...base,
          key: "sh_curvol",
          tab: "descriptive",
          title: {
            short: "Current\nVolume",
            full: "Current Volume",
            description: "",
          },
          options: [
            { value: "", label: "Any" },
            { value: "modal", label: "Custom", isEliteOnly: true },
          ],
          optionGroups: [
            {
              label: "Shares",
              options: [
                { value: "o100", label: "Over 100K" },
                { value: "halted", label: "Halted", isEliteOnly: true },
              ],
            },
          ],
        },
        {
          ...base,
          key: "sh_trades",
          isEliteOnly: true,
          options: [{ value: "o0", label: "Over 0" }],
        },
        {
          ...base,
          key: "etf_heldby",
          tab: "etf",
          uiType: "tickersInput",
          options: [],
        },
        { ...base, key: "fund_only", screenerTypes: ["etf"], options: [] },
      ]),
    );
    expect(reading.state).toBe("read");
    if (reading.state !== "read") return;
    expect(reading.source).toMatchObject({
      filtersVersion: "00aa11bb22cc33dd",
      screenerVersion: 41,
      measuredOn: "2026-11-16",
    });
    expect(reading.source.filters.map((filter) => filter.key)).toEqual([
      "sec",
      "industry",
      "sh_curvol",
    ]);
    expect(reading.source.filters[0]!.description).toBe(
      "Sector de la empresa.",
    );
    expect(reading.source.filters[1]!.options).toEqual([
      { value: "semiconductors", label: "Semiconductors", group: "Technology" },
      { value: "oilgasep", label: "Oil & Gas E&P", group: "Energy" },
    ]);
    expect(reading.source.filters[2]).toMatchObject({
      label: "Current Volume",
      options: [{ value: "o100", label: "Over 100K", group: "Shares" }],
    });
    expect(reading.eliteOptions).toBe(3);
    expect(reading.excluded).toEqual([
      { key: "sh_trades", reason: "elite_only" },
      { key: "etf_heldby", reason: "elite_only" },
      { key: "fund_only", reason: "not_stocks" },
    ]);
  });

  it("names a filter left without free options", () => {
    const reading = readFinvizScreenerPage(
      page([
        {
          ...sector,
          options: [{ value: "modal", label: "Custom", isEliteOnly: true }],
        },
      ]),
    );
    expect(reading).toMatchObject({
      state: "read",
      excluded: [{ key: "sec", reason: "no_free_options" }],
    });
  });

  it("refuses a page whose shape changed", () => {
    expect(readFinvizScreenerPage("<html></html>")).toMatchObject({
      reason: "props_missing",
    });
    expect(
      readFinvizScreenerPage(page([{ ...sector, isPremium: true }])),
    ).toMatchObject({ state: "rejected", reason: "props_unexpected" });
    expect(
      readFinvizScreenerPage(
        page([{ ...sector, options: [{ value: "a b", label: "Spaced" }] }]),
      ),
    ).toMatchObject({ reason: "value_unexpected", detail: "sec:a b" });
    expect(readFinvizScreenerPage(page([sector, sector]))).toMatchObject({
      reason: "duplicate_filter",
    });
    expect(
      readFinvizScreenerPage(
        page([
          {
            ...sector,
            key: "industry",
            options: [{ value: "x", label: "X", group: "nowhere" }],
          },
        ]),
      ),
    ).toMatchObject({ reason: "group_unresolved", detail: "industry" });
  });
});
