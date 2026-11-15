import { describe, expect, it } from "vitest";

import {
  ema,
  macd,
  rsi,
  sma,
  vwap,
  type IndicatorCandle,
  type IndicatorResult,
  type IndicatorSeries,
} from "./technical-indicators";

function valuesOf<T>(result: IndicatorResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.values;
}

function rounded(series: IndicatorSeries, digits = 6): (number | null)[] {
  return series.map((value) =>
    value === null ? null : Number(value.toFixed(digits)),
  );
}

// La planilla de Wilder (cierres de 20 sesiones), calculada aparte con
// fracciones exactas en Python.
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
  46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
];

// 40 cierres en zigzag con tendencia, también calculados aparte.
const ZIGZAG = Array.from(
  { length: 40 },
  (_, i) => 100 + ((i * 7) % 11) - 5 + i,
);

describe("technical-indicators-1.0.0", () => {
  it("averages the last n closes and leaves the warm-up null", () => {
    expect(valuesOf(sma([1, 2, 3, 4, 5], 3))).toEqual([null, null, 2, 3, 4]);
    expect(valuesOf(sma([7], 1))).toEqual([7]);
    expect(valuesOf(sma([1, 2], 3))).toEqual([null, null]);
  });

  it("seeds the EMA with the SMA and never with a single close", () => {
    // α = 0,5: sobre una recta, la EMA(3) queda un punto atrás.
    expect(valuesOf(ema([1, 2, 3, 4, 5, 6], 3))).toEqual([
      null,
      null,
      2,
      3,
      4,
      5,
    ]);
    expect(valuesOf(ema([], 9))).toEqual([]);
  });

  it("matches Wilder's RSI worksheet", () => {
    const values = rounded(valuesOf(rsi(WILDER)), 6);
    expect(values.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(values.slice(14)).toEqual([
      70.464135, 66.249619, 66.480942, 69.346853, 66.294713, 57.915021,
    ]);
  });

  it("reads 100 without losses and null without any movement", () => {
    const rising = Array.from({ length: 16 }, (_, i) => 10 + i);
    expect(valuesOf(rsi(rising)).at(-1)).toBe(100);
    expect(valuesOf(rsi(Array(16).fill(10))).at(-1)).toBeNull();
    expect(valuesOf(rsi(rising.slice(0, 14)))).toEqual(Array(14).fill(null));
  });

  it("builds MACD, its signal and histogram from the seeded EMAs", () => {
    const { macd: line, signal, histogram } = valuesOf(macd(ZIGZAG));
    expect(line.slice(0, 25).every((value) => value === null)).toBe(true);
    expect(line[25]).toBeCloseTo(7.322555689441941, 12);
    expect(signal.slice(0, 33).every((value) => value === null)).toBe(true);
    expect(line[33]).toBeCloseTo(6.66710672900639, 12);
    expect(signal[33]).toBeCloseTo(7.141762290002732, 12);
    expect(line[39]).toBeCloseTo(7.314270150317433, 12);
    expect(signal[39]).toBeCloseTo(7.133275172122659, 12);
    expect(histogram[39]).toBeCloseTo(
      7.314270150317433 - 7.133275172122659,
      12,
    );
  });

  it("anchors VWAP at each session and waits for volume", () => {
    const candle = (
      session: string,
      high: number,
      low: number,
      close: number,
      volume: number,
    ): IndicatorCandle => ({ session, high, low, close, volume });
    const values = valuesOf(
      vwap([
        candle("a", 11, 9, 10, 0),
        candle("a", 12, 9, 12, 100),
        candle("a", 15, 12, 15, 300),
        candle("b", 21, 18, 18, 50),
      ]),
    );
    expect(values[0]).toBeNull();
    expect(values[1]).toBe(11);
    // (11 × 100 + 14 × 300) / 400
    expect(values[2]).toBe(13.25);
    // Sesión nueva: sólo su vela.
    expect(values[3]).toBe(19);
  });

  it("refuses a series with a non-positive or non-finite price", () => {
    expect(sma([1, 0, 2], 2)).toEqual({
      ok: false,
      reason: "non_positive_price",
    });
    expect(ema([1, -2], 2)).toEqual({
      ok: false,
      reason: "non_positive_price",
    });
    expect(rsi([1, Number.NaN])).toEqual({
      ok: false,
      reason: "non_finite_value",
    });
    expect(macd([1, Infinity])).toEqual({
      ok: false,
      reason: "non_finite_value",
    });
    expect(
      vwap([{ session: "a", high: 1, low: 1, close: 1, volume: -1 }]),
    ).toEqual({ ok: false, reason: "negative_volume" });
    expect(
      vwap([{ session: "a", high: 1, low: 1, close: 1, volume: Infinity }]),
    ).toEqual({ ok: false, reason: "non_finite_value" });
  });

  it("refuses a period that is not a positive integer", () => {
    expect(sma([1], 0)).toEqual({ ok: false, reason: "invalid_period" });
    expect(ema([1], 2.5)).toEqual({ ok: false, reason: "invalid_period" });
    expect(rsi([1], -1)).toEqual({ ok: false, reason: "invalid_period" });
    expect(macd([1], 26, 12)).toEqual({ ok: false, reason: "invalid_period" });
  });
});
