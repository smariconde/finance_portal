import { describe, expect, it } from "vitest";

import {
  FIXTURE_OBSERVED_AT,
  FIXTURE_UNDERLYING_IDS,
  fixtureCedearGraph,
} from "../infrastructure/fixture-cedear-publications";

import type { CedearClaim } from "./cedear-claim";
import {
  buildUnderlyingSymbolIndex,
  classifyOriginMarket,
  normalizeOriginSymbol,
  resolveCedearUnderlying,
} from "./resolve-cedear-underlying";

const U = FIXTURE_UNDERLYING_IDS;

function claim(
  originSymbols: readonly string[],
  originMarket: string | null,
): CedearClaim {
  return {
    cedearIsin: "ARFXCD000010",
    cajaValoresCode: "8001",
    programName: "FIXTURE",
    originSymbols,
    originMarket,
    reportedUnderlyingIsin: null,
    ratio: { depositaryUnits: "10", underlyingUnits: "1" },
    status: "active",
    investorScope: "all_investors",
  };
}

const index = buildUnderlyingSymbolIndex(
  fixtureCedearGraph(),
  FIXTURE_OBSERVED_AT,
);

describe("normalizeOriginSymbol", () => {
  it("translates the source's class separator to the graph's", () => {
    expect(normalizeOriginSymbol("BRK/B")).toBe("BRK-B");
    expect(normalizeOriginSymbol(" docu ")).toBe("DOCU");
    expect(normalizeOriginSymbol("BF.B")).toBe("BF-B");
  });
});

describe("classifyOriginMarket", () => {
  it("maps the US venues both issuers write and separates the foreign ones", () => {
    expect(classifyOriginMarket("NASDAQ GS")).toEqual({
      kind: "us",
      mic: "XNAS",
    });
    expect(classifyOriginMarket("nyse  arca")).toEqual({
      kind: "us",
      mic: "ARCX",
    });
    expect(classifyOriginMarket("B3")).toEqual({ kind: "foreign" });
    expect(classifyOriginMarket("Idustrial Gases")).toEqual({
      kind: "unrecognized",
    });
    expect(classifyOriginMarket(null)).toEqual({ kind: "unrecognized" });
  });
});

describe("resolveCedearUnderlying", () => {
  it("resolves a ticker on its declared venue without flags", () => {
    expect(resolveCedearUnderlying(claim(["FXA"], "NYSE"), index)).toEqual({
      status: "resolved",
      securityId: U.alphaSecurity,
      listingId: U.alphaListing,
      reportedSymbol: "FXA",
      flags: [],
    });
  });

  it("resolves the class the program names, not every class of the issuer", () => {
    const resolution = resolveCedearUnderlying(claim(["FXC/A"], "NYSE"), index);

    expect(resolution.status === "resolved" && resolution.securityId).toBe(
      U.gammaClassA,
    );
  });

  it("flags a stale US venue instead of refusing the program", () => {
    // KMB figura en NYSE y ya cotiza en Nasdaq: el ticker identifica igual.
    const resolution = resolveCedearUnderlying(claim(["FXB"], "NYSE"), index);

    expect(resolution).toMatchObject({
      status: "resolved",
      securityId: U.betaSecurity,
      flags: ["origin_market_stale"],
    });
  });

  it("flags a market field that holds something else", () => {
    expect(
      resolveCedearUnderlying(claim(["FXA"], "Idustrial Gases"), index),
    ).toMatchObject({
      status: "resolved",
      flags: ["origin_market_unrecognized"],
    });
  });

  it("leaves a foreign listing out even when its ticker is in the graph", () => {
    expect(resolveCedearUnderlying(claim(["FXD"], "B3"), index)).toEqual({
      status: "outside_universe",
      reason: "foreign_market",
    });
  });

  it("leaves out a ticker the graph does not have", () => {
    expect(
      resolveCedearUnderlying(claim(["QQQX"], "NASDAQ GM"), index),
    ).toEqual({
      status: "outside_universe",
      reason: "symbol_not_in_universe",
    });
  });

  it("rejects a row whose two tickers point at different securities", () => {
    expect(
      resolveCedearUnderlying(claim(["FXA", "FXB"], "NYSE"), index),
    ).toEqual({ status: "rejected", code: "underlying_ticker_conflict" });
    // TLN declara GEV: el principal no está y el otro sí.
    expect(
      resolveCedearUnderlying(claim(["FXZ", "FXA"], "NYSE"), index),
    ).toEqual({ status: "rejected", code: "underlying_ticker_conflict" });
  });

  it("flags a second ticker that is no longer in the graph", () => {
    // MRSH declara MMC, que fue su ticker anterior.
    expect(
      resolveCedearUnderlying(claim(["FXA", "FXOLD"], "NYSE"), index),
    ).toMatchObject({
      status: "resolved",
      securityId: U.alphaSecurity,
      flags: ["origin_ticker_stale"],
    });
  });

  it("uses the symbols in force at the observation, not later ones", () => {
    const graph = fixtureCedearGraph();
    const early = buildUnderlyingSymbolIndex(graph, "2026-09-01T00:00:00.000Z");

    // El grafo de la fixture empieza el 2026-09-05: antes no hay símbolos.
    expect(resolveCedearUnderlying(claim(["FXA"], "NYSE"), early)).toEqual({
      status: "outside_universe",
      reason: "symbol_not_in_universe",
    });
  });

  it("refuses a ticker that reaches two securities at once", () => {
    const graph = fixtureCedearGraph();
    const duplicated = {
      ...graph,
      listingSymbols: graph.listingSymbols.map((symbol) =>
        symbol.listingId === U.betaListing
          ? { ...symbol, symbol: "FXA" }
          : symbol,
      ),
    };

    expect(
      resolveCedearUnderlying(
        claim(["FXA"], "NYSE"),
        buildUnderlyingSymbolIndex(duplicated, FIXTURE_OBSERVED_AT),
      ),
    ).toEqual({ status: "rejected", code: "underlying_ambiguous" });
  });
});
