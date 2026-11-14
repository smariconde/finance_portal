import { describe, expect, it } from "vitest";

import { parseSchwabPriceHistory } from "./schwab-price-history";

/** Cuerpos sintéticos con la forma medida el 2026-11-14; ningún payload real. */
const body = (text: string) => new TextEncoder().encode(text);
const candle = (datetime: number, overrides = "") =>
  `{"open":10.5,"high":11.123456,"low":10.25,"close":11.0,"volume":1200${overrides},"datetime":${datetime}}`;
const window = { symbol: "SYN", from: 1_000, to: 5_000 };

describe("schwab-price-history-1.0.0", () => {
  it("reads every price from its source text and keeps the window", () => {
    const result = parseSchwabPriceHistory(
      body(
        `{"symbol":"SYN","empty":false,"candles":[${candle(500)},${candle(1000)},${candle(2000)},${candle(9000)}]}`,
      ),
      window,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        symbol: "SYN",
        candles: [1000, 2000].map((time) => ({
          time,
          open: "10.5",
          high: "11.123456",
          low: "10.25",
          close: "11",
          volume: "1200",
        })),
      },
    });
  });

  it("reads an empty answer as no candles", () => {
    expect(
      parseSchwabPriceHistory(
        body(`{"symbol":"SYN","empty":true,"candles":[]}`),
        window,
      ),
    ).toEqual({ ok: true, value: { symbol: "SYN", candles: [] } });
  });

  it("refuses a changed cable by name, never with a value", () => {
    const cases: [string, string][] = [
      ["not json", "invalid_json"],
      [
        `{"symbol":"SYN","empty":false,"candles":[],"extra":1}`,
        "price_history_schema_changed",
      ],
      [
        `{"symbol":"OTHER","empty":true,"candles":[]}`,
        "price_history_symbol_mismatch",
      ],
      [
        `{"symbol":"SYN","empty":true,"candles":[${candle(2000)}]}`,
        "price_history_empty_mismatch",
      ],
      [
        `{"symbol":"SYN","empty":false,"candles":[${candle(2000)},${candle(2000)}]}`,
        "price_history_not_ascending",
      ],
      [
        `{"symbol":"SYN","empty":false,"candles":[{"open":10,"high":9,"low":10,"close":10,"volume":1,"datetime":2000}]}`,
        "price_history_candle_inconsistent",
      ],
      [
        `{"symbol":"SYN","empty":false,"candles":[{"open":0,"high":1,"low":0,"close":1,"volume":1,"datetime":2000}]}`,
        "price_history_non_positive",
      ],
      [
        `{"symbol":"SYN","empty":false,"candles":[{"open":1,"high":1,"low":1,"close":1,"volume":-1,"datetime":2000}]}`,
        "price_history_negative_volume",
      ],
    ];
    for (const [text, code] of cases) {
      const result = parseSchwabPriceHistory(body(text), window);
      expect(result.ok, code).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(code);
        expect(JSON.stringify(result)).not.toMatch(/10\.5|11\.1/u);
      }
    }
  });
});
