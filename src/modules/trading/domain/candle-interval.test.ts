import { describe, expect, it } from "vitest";

import { aggregateCandles, candleIntervalsOf } from "./candle-interval";

// 2026-11-19 09:30 en Nueva York (UTC−5).
const OPEN = Date.parse("2026-11-19T14:30:00Z");
const MINUTE = 60_000;

const candle = (
  minute: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume = "100",
) => ({ time: OPEN + minute * MINUTE, open, high, low, close, volume });

describe("candleIntervalsOf", () => {
  it("offers the native interval and its longer multiples", () => {
    expect(candleIntervalsOf({ kind: "minute", minutes: 1 })).toEqual([
      1, 5, 15, 30,
    ]);
    expect(candleIntervalsOf({ kind: "minute", minutes: 5 })).toEqual([
      5, 15, 30,
    ]);
    expect(candleIntervalsOf({ kind: "daily" })).toEqual([]);
  });
});

describe("aggregateCandles", () => {
  const minutes = [
    candle(0, "10.00", "10.05", "9.98", "10.02"),
    candle(1, "10.02", "10.10", "10.01", "10.08", "250"),
    candle(2, "10.08", "10.09", "9.95", "9.97"),
    candle(4, "9.97", "10.00", "9.96", "9.99"),
    candle(5, "9.99", "10.20", "9.99", "10.18", "40"),
  ];

  it("takes the first open, the extremes, the last close and the summed volume", () => {
    const { candles, indexOf } = aggregateCandles(minutes, 5);
    expect(candles).toEqual([
      {
        time: OPEN,
        open: "10.00",
        high: "10.10",
        low: "9.95",
        close: "9.99",
        volume: "550",
      },
      {
        time: OPEN + 5 * MINUTE,
        open: "9.99",
        high: "10.20",
        low: "9.99",
        close: "10.18",
        volume: "40",
      },
    ]);
    expect(indexOf).toEqual([0, 0, 0, 0, 1]);
  });

  it("starts the 9:30 candle at the open for 15 and 30 minutes too", () => {
    expect(aggregateCandles(minutes, 15).candles[0]!.time).toBe(OPEN);
    expect(aggregateCandles(minutes, 30).candles[0]!.time).toBe(OPEN);
  });

  it("is the same series at the native interval", () => {
    const { candles, indexOf } = aggregateCandles(minutes, 1);
    expect(candles.map((c) => c.close)).toEqual(minutes.map((c) => c.close));
    expect(indexOf).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses candles out of order and a non-whole interval", () => {
    expect(() => aggregateCandles([minutes[4]!, minutes[0]!], 5)).toThrow();
    expect(() => aggregateCandles(minutes, 2.5)).toThrow();
    expect(aggregateCandles([], 5)).toEqual({ candles: [], indexOf: [] });
  });
});
