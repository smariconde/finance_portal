import { describe, expect, it } from "vitest";

import { newYorkInstant, placeFills, planTradeChart } from "./trade-chart";
import type { Candle } from "./schwab-price-history";
import type { FillPortion } from "./trade-round-trips";

function portion(
  executedAt: string,
  side: "buy" | "sell",
  price: string,
): FillPortion {
  return {
    fillId: `${executedAt}-${side}`,
    side,
    role: side === "buy" ? "open" : "close",
    quantity: "5",
    price,
    netAmount: side === "buy" ? "-50" : "50",
    executedAt,
    realizedPnl: null,
  };
}

function dayTrade(session: string, portions: FillPortion[]) {
  return {
    status: "closed" as const,
    dayTrade: true,
    openedAt: portions[0]!.executedAt,
    openedSession: session,
    closedSession: session,
    portions,
  };
}

describe("New York wall clock", () => {
  it("follows daylight saving time", () => {
    expect(new Date(newYorkInstant("2026-04-29", "09:30")).toISOString()).toBe(
      "2026-04-29T13:30:00.000Z",
    );
    expect(new Date(newYorkInstant("2026-01-14", "09:30")).toISOString()).toBe(
      "2026-01-14T14:30:00.000Z",
    );
    expect(new Date(newYorkInstant("2026-03-08", "04:00")).toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
  });
});

describe("trade-chart-1.0.0", () => {
  const fills = [
    portion("2026-04-29T14:05:08.000Z", "buy", "372.89"),
    portion("2026-04-29T14:59:00.000Z", "sell", "373.13"),
  ];

  it("draws a recent day trade with one-minute candles of its regular session", () => {
    const plan = planTradeChart(
      dayTrade("2026-04-29", fills),
      "2026-05-20T15:00:00.000Z",
    );
    expect(plan).toMatchObject({
      resolution: { kind: "minute", minutes: 1 },
      extendedHours: false,
      fallback: null,
      from: Date.parse("2026-04-29T13:30:00.000Z"),
      to: Date.parse("2026-04-29T20:00:00.000Z") - 1,
      params: {
        frequencyType: "minute",
        frequency: "1",
        needExtendedHoursData: "false",
      },
    });
  });

  it("moves to five minutes, then to daily candles with the reason named", () => {
    expect(
      planTradeChart(dayTrade("2026-04-29", fills), "2026-11-14T15:00:00.000Z")
        .resolution,
    ).toEqual({ kind: "minute", minutes: 5 });
    const old = planTradeChart(
      dayTrade("2025-02-12", [
        portion("2025-02-12T15:00:00.000Z", "buy", "10"),
      ]),
      "2026-11-14T15:00:00.000Z",
    );
    expect(old).toMatchObject({
      resolution: { kind: "daily" },
      fallback: "intraday_beyond_depth",
      from: Date.parse("2024-10-15T00:00:00.000Z"),
      params: { periodType: "year", frequencyType: "daily" },
    });
  });

  it("asks for extended hours only when a fill fell outside the regular session", () => {
    const premarket = [
      portion("2026-11-10T12:15:00.000Z", "buy", "10"),
      ...fills.slice(1),
    ];
    const plan = planTradeChart(
      dayTrade("2026-11-10", premarket),
      "2026-11-14T15:00:00.000Z",
    );
    expect(plan.extendedHours).toBe(true);
    expect(plan.from).toBe(Date.parse("2026-11-10T09:00:00.000Z"));
  });

  it("draws a swing with daily candles, never past now", () => {
    const now = "2026-11-14T15:00:00.000Z";
    const plan = planTradeChart(
      {
        status: "open",
        dayTrade: false,
        openedAt: "2026-11-02T15:00:00.000Z",
        openedSession: "2026-11-02",
        closedSession: null,
        portions: [portion("2026-11-02T15:00:00.000Z", "buy", "10")],
      },
      now,
    );
    expect(plan).toMatchObject({
      resolution: { kind: "daily" },
      fallback: null,
    });
    expect(plan.to).toBe(Date.parse(now));
  });

  it("places each fill in its candle and counts those outside its range", () => {
    const candles: Candle[] = [0, 1, 2].map((minute) => ({
      time: Date.parse("2026-04-29T14:04:00.000Z") + minute * 60_000,
      open: "372.5",
      high: "373",
      low: "372.4",
      close: "372.9",
      volume: "100",
    }));
    const markers = placeFills(
      candles,
      [
        portion("2026-04-29T14:05:08.000Z", "buy", "372.89"),
        portion("2026-04-29T14:06:59.000Z", "sell", "380"),
        portion("2026-04-29T15:00:00.000Z", "sell", "373"),
      ],
      { kind: "minute", minutes: 1 },
    );
    expect(markers.map((m) => [m.candleIndex, m.outsideCandle])).toEqual([
      [1, false],
      [2, true],
      [null, false],
    ]);
  });

  it("places a fill in its session's daily candle, dated at Chicago midnight", () => {
    const candles: Candle[] = [
      "2026-04-28T05:00:00.000Z",
      "2026-04-29T05:00:00.000Z",
    ].map((at) => ({
      time: Date.parse(at),
      open: "1",
      high: "2",
      low: "1",
      close: "2",
      volume: "1",
    }));
    const [marker] = placeFills(
      candles,
      [portion("2026-04-29T23:30:00.000Z", "buy", "1.5")],
      { kind: "daily" },
    );
    expect(marker!.candleIndex).toBe(1);
  });
});
