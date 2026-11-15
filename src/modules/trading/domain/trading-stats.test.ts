import { describe, expect, it } from "vitest";

import { sessionExits } from "./daily-pnl";
import type { RMultiple } from "./trade-r-multiple";
import { buildRoundTrips, type TradeFill } from "./trade-round-trips";
import {
  cutBy,
  isoWeekdayOf,
  newYorkHourOf,
  realizedDrawdown,
  tradeStatsOf,
  tradingStats,
  type StatsTrade,
} from "./trading-stats";

let sequence = 0;

const NO_STOP: RMultiple = { value: null, reason: "no_planned_stop" };

function trade(
  realizedPnl: string | null,
  extra: Partial<StatsTrade> = {},
): StatsTrade {
  sequence += 1;
  return {
    tradeId: `t${sequence}`,
    symbol: "SYN",
    currency: "USD",
    status: "closed",
    // 15:00Z is 10:00 in New York (EST); 2026-11-10 is a Tuesday.
    openedAt: "2026-11-10T15:00:00Z",
    openedSession: "2026-11-10",
    dayTrade: true,
    realizedPnl,
    setupCode: null,
    r: NO_STOP,
    ...extra,
  };
}

const r = (value: string): RMultiple => ({ value, reason: null });

describe("tradeStatsOf", () => {
  it("is null without trades, never zeros", () => {
    expect(tradeStatsOf([])).toBeNull();
  });

  it("computes win rate, expectancy and profit factor in decimal", () => {
    const stats = tradeStatsOf([
      trade("30"),
      trade("10"),
      trade("-20"),
      trade("0"),
    ])!;
    expect(stats).toMatchObject({
      trades: 4,
      winners: 2,
      losers: 1,
      // A trade at zero is not a win and still counts.
      breakeven: 1,
      winRate: "0.5",
      realizedPnl: "20",
      grossProfit: "40",
      grossLoss: "20",
      averageWin: "20",
      averageLoss: "20",
      expectancy: "5",
      profitFactor: { value: "2", reason: null },
      smallSample: true,
    });
  });

  it("keeps cents exact where floats would drift", () => {
    const stats = tradeStatsOf([trade("0.1"), trade("0.2"), trade("-0.3")])!;
    expect(stats.realizedPnl).toBe("0");
    expect(stats.expectancy).toBe("0");
    expect(stats.profitFactor.value).toBe("1");
  });

  it("gives no profit factor without losses, never infinity", () => {
    const stats = tradeStatsOf([trade("5"), trade("0")])!;
    expect(stats.profitFactor).toEqual({ value: null, reason: "no_losses" });
    expect(stats.averageLoss).toBeNull();
  });

  it("gives a profit factor of zero with only losses", () => {
    const stats = tradeStatsOf([trade("-5"), trade("-1")])!;
    expect(stats.profitFactor).toEqual({ value: "0", reason: null });
    expect(stats.averageWin).toBeNull();
    expect(stats.winRate).toBe("0");
    expect(stats.expectancy).toBe("-3");
  });

  it("averages R over the trades that have it and names the rest", () => {
    const stats = tradeStatsOf([
      trade("20", { r: r("2") }),
      trade("-10", { r: r("-1") }),
      trade("50"),
    ])!;
    expect(stats.expectancyR).toEqual({
      value: "0.5",
      reason: null,
      n: 2,
      missing: 1,
    });
  });

  it("gives no R expectancy when no trade has R, with the first reason", () => {
    const stats = tradeStatsOf([
      trade("1", { r: { value: null, reason: "stop_on_wrong_side" } }),
      trade("2"),
    ])!;
    expect(stats.expectancyR).toEqual({
      value: null,
      reason: "stop_on_wrong_side",
      n: 0,
      missing: 2,
    });
  });

  it("refuses a closed trade without realized P&L instead of reading zero", () => {
    expect(() => tradeStatsOf([trade(null)])).toThrow(/no realized P&L/u);
  });

  it("marks a group below the small-sample threshold", () => {
    const five = Array.from({ length: 5 }, () => trade("1"));
    expect(tradeStatsOf(five)!.smallSample).toBe(false);
    expect(tradeStatsOf(five.slice(1))!.smallSample).toBe(true);
  });
});

describe("cut keys", () => {
  it("reads the entry hour on New York's clock across DST", () => {
    // 13:45Z is 09:45 in EDT (October) and 08:45 in EST (November).
    expect(newYorkHourOf("2026-10-15T13:45:00Z")).toBe("09");
    expect(newYorkHourOf("2026-11-16T13:45:00Z")).toBe("08");
    expect(newYorkHourOf("2026-11-16T20:59:00Z")).toBe("15");
    expect(() => newYorkHourOf("not a date")).toThrow();
  });

  it("reads the ISO weekday of a session", () => {
    expect(isoWeekdayOf("2026-11-16")).toBe("1");
    expect(isoWeekdayOf("2026-11-20")).toBe("5");
    expect(isoWeekdayOf("2026-11-15")).toBe("7");
  });
});

describe("cutBy", () => {
  it("cuts by setup with the unlabeled trades last", () => {
    const groups = cutBy(
      [
        trade("1", { setupCode: "orb" }),
        trade("-1"),
        trade("2", { setupCode: "pullback" }),
        trade("3", { setupCode: "pullback" }),
      ],
      "setup",
    );
    expect(groups.map((g) => [g.key, g.stats.trades])).toEqual([
      ["pullback", 2],
      ["orb", 1],
      [null, 1],
    ]);
  });

  it("cuts by entry hour and weekday in natural order", () => {
    const trades = [
      trade("1", {
        openedAt: "2026-11-13T19:30:00Z",
        openedSession: "2026-11-13",
      }),
      trade("1", {
        openedAt: "2026-11-09T14:35:00Z",
        openedSession: "2026-11-09",
      }),
      trade("1"),
    ];
    expect(cutBy(trades, "hour").map((g) => g.key)).toEqual(["09", "10", "14"]);
    expect(cutBy(trades, "weekday").map((g) => g.key)).toEqual(["1", "2", "5"]);
  });

  it("cuts by ticker by size and by day or swing", () => {
    const trades = [
      trade("1", { symbol: "B", dayTrade: false }),
      trade("1", { symbol: "A" }),
      trade("1", { symbol: "B" }),
    ];
    expect(cutBy(trades, "ticker").map((g) => g.key)).toEqual(["B", "A"]);
    expect(
      cutBy(trades, "holding").map((g) => [g.key, g.stats.trades]),
    ).toEqual([
      ["day", 2],
      ["swing", 1],
    ]);
  });
});

function fill(
  side: "buy" | "sell",
  quantity: string,
  netAmount: string,
  executedAt: string,
): TradeFill {
  sequence += 1;
  return {
    fillId: String(sequence),
    accountKey: "acct",
    instrumentKey: "schwab:1",
    symbol: "SYN",
    assetType: "EQUITY",
    multiplier: "1",
    currency: "USD",
    side,
    quantity,
    price: "10",
    netAmount,
    fees: "0",
    executedAt,
    positionEffect: side === "buy" ? "opening" : "closing",
  };
}

const at = (day: string) => `2026-11-${day}T15:00:00Z`;

/** Un trade de una entrada y una salida que realiza `pnl` sobre 100. */
function roundTrip(pnl: number, buyDay: string, sellDay: string) {
  return [
    fill("buy", "1", "-100", at(buyDay)),
    fill("sell", "1", String(100 + pnl), at(sellDay)),
  ];
}

describe("realizedDrawdown", () => {
  it("is null without exits of known P&L", () => {
    expect(realizedDrawdown([])).toBeNull();
    const before = buildRoundTrips([fill("sell", "1", "10", at("09"))]);
    expect(realizedDrawdown(sessionExits(before, new Map()))).toBeNull();
  });

  it("measures the deepest fall from a prior high and its recovery", () => {
    const trades = buildRoundTrips([
      ...roundTrip(50, "02", "03"), // 50
      ...roundTrip(-30, "04", "05"), // 20
      ...roundTrip(-40, "06", "09"), // −20: 70 below the 50 high
      ...roundTrip(80, "10", "11"), // 60: a new high recovers it
      ...roundTrip(-10, "12", "13"), // 50
    ]);
    const drawdown = realizedDrawdown(sessionExits(trades, new Map()))!;
    expect(drawdown.curve.map((p) => [p.cumulative, p.drawdown])).toEqual([
      ["50", "0"],
      ["20", "-30"],
      ["-20", "-70"],
      ["60", "0"],
      ["50", "-10"],
    ]);
    expect(drawdown.max).toEqual({
      amount: "70",
      peakAt: at("03"),
      peak: "50",
      troughAt: at("09"),
      trough: "-20",
      recoveredAt: at("11"),
    });
    expect(drawdown.current).toBe("-10");
  });

  it("starts at zero: a first loss falls from the start of history", () => {
    const trades = buildRoundTrips([
      ...roundTrip(-25, "02", "03"),
      ...roundTrip(5, "04", "05"),
    ]);
    const drawdown = realizedDrawdown(sessionExits(trades, new Map()))!;
    expect(drawdown.max).toMatchObject({
      amount: "25",
      peakAt: null,
      peak: "0",
      trough: "-25",
      recoveredAt: null,
    });
    expect(drawdown.current).toBe("-20");
  });

  it("is a measured zero when the curve never fell", () => {
    const trades = buildRoundTrips([
      ...roundTrip(5, "02", "03"),
      ...roundTrip(0, "04", "05"),
    ]);
    const drawdown = realizedDrawdown(sessionExits(trades, new Map()))!;
    expect(drawdown.max).toEqual({
      amount: "0",
      peakAt: null,
      peak: "5",
      troughAt: null,
      trough: "5",
      recoveredAt: null,
    });
    expect(drawdown.current).toBe("0");
  });

  it("counts a partial exit on the day it ran", () => {
    const trades = buildRoundTrips([
      fill("buy", "2", "-200", at("02")),
      fill("sell", "1", "90", at("03")), // −10
      fill("sell", "1", "130", at("05")), // +30
    ]);
    const drawdown = realizedDrawdown(sessionExits(trades, new Map()))!;
    expect(drawdown.curve.map((p) => [p.session, p.cumulative])).toEqual([
      ["2026-11-03", "-10"],
      ["2026-11-05", "20"],
    ]);
    expect(drawdown.max.recoveredAt).toBe(at("05"));
  });
});

describe("tradingStats", () => {
  it("counts open and pre-history trades apart, never as zeros", () => {
    const stats = tradingStats(
      [
        trade("10"),
        trade("-5", { status: "open" }),
        trade(null, { status: "opened_before_history" }),
      ],
      [],
    );
    expect(stats.state).toBe("ready");
    if (stats.state !== "ready") return;
    expect(stats.excluded).toEqual({ open: 1, beforeHistory: 1 });
    expect(stats.overall?.trades).toBe(1);
    expect(stats.cuts.ticker).toHaveLength(1);
    expect(stats.drawdown).toBeNull();
  });

  it("has no overall figures without closed trades", () => {
    const stats = tradingStats([], []);
    expect(stats).toMatchObject({ state: "ready", overall: null });
  });

  it("refuses to add two currencies", () => {
    expect(
      tradingStats([trade("1"), trade("1", { currency: "EUR" })], []),
    ).toEqual({ state: "currency_mismatch", currencies: ["EUR", "USD"] });
  });
});
