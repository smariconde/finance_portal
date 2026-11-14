import { describe, expect, it } from "vitest";

import {
  calendarBook,
  monthlyTotals,
  periodPnl,
  sessionExits,
  sessionPnl,
  tradingCalendar,
  weekOf,
} from "./daily-pnl";
import { buildRoundTrips, type TradeFill } from "./trade-round-trips";

let sequence = 0;

function fill(
  side: "buy" | "sell",
  quantity: string,
  netAmount: string,
  executedAt: string,
  extra: Partial<TradeFill> = {},
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
    ...extra,
  };
}

// New York sessions: 15:00Z is 10:00 in EST.
const at = (session: string, hour = "15") => `${session}T${hour}:00:00Z`;

describe("sessionExits", () => {
  it("attributes a swing trade's partial exits to the sessions they ran in", () => {
    const trades = buildRoundTrips([
      fill("buy", "3", "-10", at("2026-11-09")),
      // 4 − 10/3 = 0.6667 → 0.67 on Tuesday.
      fill("sell", "1", "4", at("2026-11-10")),
      // The closing exit takes the rest: 2 − 0.67 = 1.33.
      fill("sell", "2", "8", at("2026-11-12")),
    ]);
    const exits = sessionExits(trades, new Map());
    expect(exits.map((e) => [e.session, e.realizedPnl])).toEqual([
      ["2026-11-10", "0.67"],
      ["2026-11-12", "1.33"],
    ]);
    // The calendar reconciles with the journal to the cent.
    expect(periodPnl(exits)!.realizedPnl).toBe(trades[0]!.realizedPnl);
    expect(trades[0]!.realizedPnl).toBe("2");
  });

  it("dates an evening exit by New York, not UTC", () => {
    const trades = buildRoundTrips([
      fill("buy", "1", "-10", at("2026-11-13", "14")),
      // 00:30Z on the 14th is 19:30 on the 13th in New York.
      fill("sell", "1", "11", "2026-11-14T00:30:00Z"),
    ]);
    expect(sessionExits(trades, new Map())[0]!.session).toBe("2026-11-13");
  });

  it("carries R per exit against the trade's initial risk", () => {
    const trades = buildRoundTrips([
      fill("buy", "2", "-20", at("2026-11-09")),
      fill("sell", "1", "12", at("2026-11-10")),
      fill("sell", "1", "9", at("2026-11-11")),
    ]);
    const stops = new Map([
      [trades[0]!.tradeId, { price: "9", currency: "USD" }],
    ]);
    // Risk (10 − 9) × 2 = 2: +2 is 1R, −1 is −0.5R; the trade is 0.5R.
    expect(sessionExits(trades, stops).map((e) => e.r.value)).toEqual([
      "1",
      "-0.5",
    ]);
  });

  it("names an exit without its entry instead of reading it as zero", () => {
    const trades = buildRoundTrips([
      fill("sell", "5", "50", at("2026-11-09")),
      fill("buy", "1", "-10", at("2026-11-09", "16")),
      fill("sell", "1", "12", at("2026-11-09", "17")),
    ]);
    const day = sessionPnl("2026-11-09", sessionExits(trades, new Map()))!;
    expect(day).toMatchObject({
      exits: 2,
      trades: 2,
      realizedPnl: "2",
      unknownExits: 1,
    });
  });
});

describe("periodPnl", () => {
  it("is null without exits, never a zero day", () => {
    expect(periodPnl([])).toBeNull();
  });

  it("has no R total while any exit lacks a stop", () => {
    const trades = buildRoundTrips([
      fill("buy", "1", "-10", at("2026-11-09")),
      fill("sell", "1", "11", at("2026-11-09", "16")),
      fill("buy", "1", "-10", at("2026-11-09", "17"), {
        instrumentKey: "schwab:2",
      }),
      fill("sell", "1", "9", at("2026-11-09", "18"), {
        instrumentKey: "schwab:2",
      }),
    ]);
    const stops = new Map([
      [trades[0]!.tradeId, { price: "9", currency: "USD" }],
    ]);
    expect(periodPnl(sessionExits(trades, stops))).toMatchObject({
      realizedPnl: "0",
      trades: 2,
      r: { value: null, reason: "no_planned_stop", missing: 1 },
    });
  });

  it("sums R when every exit has it", () => {
    const trades = buildRoundTrips([
      fill("buy", "1", "-10", at("2026-11-09")),
      fill("sell", "1", "12", at("2026-11-09", "16")),
    ]);
    const stops = new Map([
      [trades[0]!.tradeId, { price: "9", currency: "USD" }],
    ]);
    expect(periodPnl(sessionExits(trades, stops))!.r).toEqual({
      value: "2",
      reason: null,
      missing: 0,
    });
  });
});

describe("weekOf", () => {
  it.each([
    ["2026-11-09", "2026-11-09"],
    ["2026-11-13", "2026-11-09"],
    ["2026-11-15", "2026-11-09"],
    ["2026-01-01", "2025-12-29"],
  ])("%s falls in the week of %s", (session, monday) => {
    expect(weekOf(session)).toBe(monday);
  });
});

describe("tradingCalendar", () => {
  const trades = buildRoundTrips([
    // Friday 2026-10-30 is October's, in a week November does not show.
    fill("buy", "1", "-10", at("2026-10-30")),
    fill("sell", "1", "13", at("2026-10-30", "16")),
    fill("buy", "1", "-10", at("2026-11-02")),
    fill("sell", "1", "11", at("2026-11-02", "16")),
    fill("buy", "1", "-10", at("2026-11-30")),
    fill("sell", "1", "8", at("2026-11-30", "16")),
  ]);
  const exits = sessionExits(trades, new Map());
  const calendar = tradingCalendar("2026-11", exits);

  it("lays out Monday-to-Friday weeks, skipping a weekend-only first week", () => {
    // November 2026 starts on a Sunday: the week of Oct 26 has no session in it.
    expect(calendar.weeks.map((w) => w.monday)).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);
    expect(calendar.weeks.at(-1)!.days.map((d) => d.inMonth)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("totals the month by its sessions and each week whole", () => {
    expect(calendar.total!.realizedPnl).toBe("-1");
    expect(calendar.weeks[0]!.total!.realizedPnl).toBe("1");
    expect(calendar.weeks[1]!.total).toBeNull();
    const october = tradingCalendar("2026-10", exits);
    expect(october.total!.realizedPnl).toBe("3");
    // The week of Oct 26 runs into November in October's view.
    expect(october.weeks.at(-1)!.monday).toBe("2026-10-26");
  });

  it("refuses something that is not a month", () => {
    expect(() => tradingCalendar("2026-13", exits)).toThrow(TypeError);
  });

  it("gives twelve months a year, null where nothing closed", () => {
    const year = monthlyTotals(2026, exits);
    expect(year).toHaveLength(12);
    expect(year[9]).toMatchObject({
      month: "2026-10",
      pnl: { realizedPnl: "3" },
    });
    expect(year[0]!.pnl).toBeNull();
  });
});

describe("calendarBook", () => {
  const trades = buildRoundTrips([
    fill("buy", "1", "-10", at("2025-11-28")),
    fill("sell", "1", "12", at("2025-11-28", "16")),
    fill("buy", "1", "-10", at("2026-02-02")),
    fill("sell", "1", "9", at("2026-02-02", "16")),
  ]);
  const exits = sessionExits(trades, new Map());

  it("runs from the first exit's month to today's, across years", () => {
    const book = calendarBook(exits, "2026-03-04");
    expect(book.months.map((m) => m.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(book.years.map((y) => [y.year, y.total?.realizedPnl])).toEqual([
      [2025, "2"],
      [2026, "-1"],
    ]);
    expect(book.today).toEqual({ session: "2026-03-04", pnl: null });
  });

  it("is today's month alone without exits", () => {
    const book = calendarBook([], "2026-11-14");
    expect(book.months.map((m) => m.month)).toEqual(["2026-11"]);
    expect(book.years[0]!.total).toBeNull();
  });

  it("reads today's realized P&L", () => {
    expect(calendarBook(exits, "2026-02-02").today.pnl!.realizedPnl).toBe("-1");
  });
});
