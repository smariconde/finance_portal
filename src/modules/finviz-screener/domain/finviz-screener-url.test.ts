import { describe, expect, it } from "vitest";

import {
  FINVIZ_FILTER_SOURCE,
  FINVIZ_FILTERS,
  FINVIZ_MEASURED_FILTERS_VERSION,
  FINVIZ_SCREENER_CATALOG_VERSION,
  FINVIZ_SIGNALS,
  FINVIZ_VIEWS,
} from "./finviz-screener-catalog";
import { FINVIZ_SCREENER_PAGE_PARSER_VERSION } from "./finviz-screener-page";
import {
  buildFinvizScreenerUrl,
  EMPTY_FINVIZ_SELECTION,
  buildFinvizQuoteUrl,
  buildFinvizTickersUrl,
  finvizFilterQuery,
  parseFinvizFilterQuery,
  readFinvizScreenerLink,
} from "./finviz-screener-url";

describe("finviz screener catalog", () => {
  it("pins the measured page to the declared version", () => {
    expect(FINVIZ_SCREENER_CATALOG_VERSION).toBe(
      "finviz-screener-catalog-1.1.0",
    );
    expect(FINVIZ_FILTER_SOURCE).toMatchObject({
      parserVersion: FINVIZ_SCREENER_PAGE_PARSER_VERSION,
      filtersVersion: FINVIZ_MEASURED_FILTERS_VERSION,
      measuredOn: "2026-11-16",
    });
  });

  it("carries the free filters measured on the page and nothing elite", () => {
    expect(FINVIZ_FILTERS).toHaveLength(78);
    expect(
      FINVIZ_FILTERS.reduce(
        (total, filter) => total + filter.options.length,
        0,
      ),
    ).toBe(2317);
    const keys = FINVIZ_FILTERS.map((filter) => filter.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const elite of [
      "sh_trades",
      "ah_close",
      "ah_change",
      "news_keywords",
      "etf_heldby",
    ])
      expect(keys).not.toContain(elite);
    for (const filter of FINVIZ_FILTERS) {
      expect(filter.label).not.toBe("");
      const values = filter.options.map((option) => option.value);
      expect(new Set(values).size).toBe(values.length);
      expect(values).not.toContain("modal");
      expect(values).not.toContain("frange");
    }
  });

  it("declares unique views and signals", () => {
    expect(new Set(FINVIZ_VIEWS.map((view) => view.code)).size).toBe(15);
    expect(new Set(FINVIZ_SIGNALS.map((signal) => signal.value)).size).toBe(33);
  });
});

describe("finviz screener links", () => {
  it("builds the link in catalog order, whatever the selection order", () => {
    expect(
      buildFinvizScreenerUrl({
        view: "111",
        signal: "ta_newhigh",
        filters: { ta_rsi: "os30", industry: "semiconductors", fa_pe: "u20" },
      }),
    ).toBe(
      "https://finviz.com/screener/stocks?v=111&f=industry_semiconductors,fa_pe_u20,ta_rsi_os30&s=ta_newhigh",
    );
    expect(
      buildFinvizScreenerUrl({ view: "211", signal: null, filters: {} }),
    ).toBe("https://finviz.com/screener/stocks?v=211");
  });

  it("reads back the link the owner saved from Finviz", () => {
    const reading = readFinvizScreenerLink(
      "https://finviz.com/screener/stocks?v=111&ft=4&f=fa_pe_u20%2Cindustry_semiconductors%2Cta_rsi_os30&s=ta_newhigh",
    );
    expect(reading).toEqual({
      state: "read",
      selection: {
        view: "111",
        signal: "ta_newhigh",
        filters: { fa_pe: "u20", industry: "semiconductors", ta_rsi: "os30" },
      },
      dropped: [],
    });
  });

  it("reads a legacy Flask link and names what the catalog does not carry", () => {
    const reading = readFinvizScreenerLink(
      "https://finviz.com/screener.ashx?v=310&s=f_halted&f=ind_semiconductors,exch_nasd|nyse,sh_curvol_o100,sh_curvol_o200,cap_frange,zz_x,fa_peg_low",
    );
    expect(reading).toEqual({
      state: "read",
      selection: {
        view: "341",
        signal: null,
        filters: {
          industry: "semiconductors",
          sh_curvol: "o100",
          fa_peg: "low",
        },
      },
      dropped: [
        { token: "v=310", reason: "unknown_view" },
        { token: "s=f_halted", reason: "unknown_signal" },
        { token: "exch_nasd|nyse", reason: "multiple_values" },
        { token: "sh_curvol_o200", reason: "repeated_filter" },
        { token: "cap_frange", reason: "unknown_option" },
        { token: "zz_x", reason: "unknown_filter" },
      ],
    });
  });

  it("opens on Snapshot unless a view is chosen", () => {
    expect(EMPTY_FINVIZ_SELECTION.view).toBe("341");
    expect(buildFinvizScreenerUrl(EMPTY_FINVIZ_SELECTION)).toBe(
      "https://finviz.com/screener/stocks?v=341",
    );
    expect(
      readFinvizScreenerLink("https://finviz.com/screener/stocks?f=fa_pe_u20"),
    ).toMatchObject({ selection: { view: "341" } });
  });

  it("refuses what is not a Finviz screener", () => {
    expect(readFinvizScreenerLink("not a url")).toEqual({
      state: "rejected",
      reason: "not_url",
    });
    expect(
      readFinvizScreenerLink("https://finviz.com.evil.example/screener?v=111"),
    ).toMatchObject({ reason: "not_finviz" });
    expect(
      readFinvizScreenerLink("http://finviz.com/screener?v=111"),
    ).toMatchObject({
      reason: "not_finviz",
    });
    expect(
      readFinvizScreenerLink("https://finviz.com/quote.ashx?t=AAPL"),
    ).toMatchObject({
      reason: "not_screener",
    });
  });

  it("round-trips every option of the catalog", () => {
    for (const filter of FINVIZ_FILTERS)
      for (const option of filter.options) {
        const query = finvizFilterQuery({ [filter.key]: option.value });
        expect(parseFinvizFilterQuery(query)).toEqual({
          filters: { [filter.key]: option.value },
          dropped: [],
        });
      }
  });

  it("builds the watchlist link with Finviz class symbols", () => {
    expect(
      buildFinvizTickersUrl(["nvda", "BRK.B", "AAPL", "NVDA", "BF/B", "1BAD"]),
    ).toBe("https://finviz.com/screener/stocks?v=341&t=AAPL,BF-B,BRK-B,NVDA");
    expect(buildFinvizTickersUrl([])).toBeNull();
  });
});

describe("buildFinvizQuoteUrl", () => {
  it("abre la ficha con el símbolo como lo escribe Finviz", () => {
    expect(buildFinvizQuoteUrl("aapl")).toBe(
      "https://finviz.com/quote.ashx?t=AAPL",
    );
    expect(buildFinvizQuoteUrl("BF.B")).toBe(
      "https://finviz.com/quote.ashx?t=BF-B",
    );
    expect(buildFinvizQuoteUrl("1BAD")).toBeNull();
    expect(buildFinvizQuoteUrl("")).toBeNull();
  });
});
