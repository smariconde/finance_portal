import { describe, expect, it } from "vitest";

import { parseSchwabMarketHours } from "./schwab-market-hours";

/** Respuestas sintéticas con la forma del esquema publicado; ninguna es real. */
function body(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

const earlyClose = {
  equity: {
    EQ: {
      date: "2026-11-27",
      marketType: "EQUITY",
      product: "EQ",
      productName: "equity",
      isOpen: true,
      sessionHours: {
        preMarket: [
          {
            start: "2026-11-27T07:00:00-05:00",
            end: "2026-11-27T09:30:00-05:00",
          },
        ],
        regularMarket: [
          {
            start: "2026-11-27T09:30:00-05:00",
            end: "2026-11-27T13:00:00-05:00",
          },
        ],
        postMarket: [
          {
            start: "2026-11-27T13:00:00-05:00",
            end: "2026-11-27T17:00:00-05:00",
          },
        ],
      },
    },
  },
};

describe("parseSchwabMarketHours", () => {
  it("reads an early close as instants", () => {
    expect(parseSchwabMarketHours(body(earlyClose), "2026-11-27")).toEqual({
      ok: true,
      value: {
        date: "2026-11-27",
        isOpen: true,
        product: "EQ",
        preMarket: {
          start: "2026-11-27T12:00:00.000Z",
          end: "2026-11-27T14:30:00.000Z",
        },
        regularMarket: {
          start: "2026-11-27T14:30:00.000Z",
          end: "2026-11-27T18:00:00.000Z",
        },
        postMarket: {
          start: "2026-11-27T18:00:00.000Z",
          end: "2026-11-27T22:00:00.000Z",
        },
      },
    });
  });

  it("reads a closed day without session hours", () => {
    const closed = {
      equity: {
        equity: {
          date: "2026-11-26",
          marketType: "EQUITY",
          product: "equity",
          isOpen: false,
        },
      },
    };
    expect(parseSchwabMarketHours(body(closed), "2026-11-26")).toMatchObject({
      ok: true,
      value: { isOpen: false, product: "equity", regularMarket: null },
    });
  });

  it("names the path of an unknown key, never its value", () => {
    const changed = structuredClone(earlyClose) as {
      equity: { EQ: Record<string, unknown> };
    };
    changed.equity.EQ.tradingHalt = "secret-value";
    expect(parseSchwabMarketHours(body(changed), "2026-11-27")).toEqual({
      ok: false,
      code: "market_hours_schema_changed",
      path: "equity.EQ.tradingHalt",
    });
  });

  it("refuses another date, a reversed interval and an empty product map", () => {
    expect(
      parseSchwabMarketHours(body(earlyClose), "2026-11-30"),
    ).toMatchObject({ ok: false, code: "market_hours_date_mismatch" });

    const reversed = structuredClone(earlyClose);
    reversed.equity.EQ.sessionHours.regularMarket = [
      { start: "2026-11-27T13:00:00-05:00", end: "2026-11-27T09:30:00-05:00" },
    ];
    expect(parseSchwabMarketHours(body(reversed), "2026-11-27")).toEqual({
      ok: false,
      code: "market_hours_interval_invalid",
      path: "equity.EQ.sessionHours.regularMarket",
    });

    expect(
      parseSchwabMarketHours(body({ equity: {} }), "2026-11-27"),
    ).toMatchObject({ ok: false, code: "market_hours_product_missing" });
  });

  it("picks EQ among several products and refuses an ambiguous pair", () => {
    const several = {
      equity: {
        EQ: earlyClose.equity.EQ,
        XX: { ...earlyClose.equity.EQ, product: "XX" },
      },
    };
    expect(parseSchwabMarketHours(body(several), "2026-11-27")).toMatchObject({
      ok: true,
      value: { product: "EQ" },
    });
    const ambiguous = {
      equity: {
        AA: earlyClose.equity.EQ,
        BB: earlyClose.equity.EQ,
      },
    };
    expect(parseSchwabMarketHours(body(ambiguous), "2026-11-27")).toMatchObject(
      { ok: false, code: "market_hours_product_ambiguous" },
    );
  });

  it("refuses what is not JSON", () => {
    expect(
      parseSchwabMarketHours(new TextEncoder().encode("<html>"), "2026-11-27"),
    ).toEqual({ ok: false, code: "invalid_json", path: null });
  });
});
