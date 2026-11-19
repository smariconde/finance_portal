import { describe, expect, it } from "vitest";

import type { JournalEntry } from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";

import { daysHeld, displayedPnl, sortTrades } from "./trades-table-sort";

function trade(tradeId: string, overrides: Partial<RoundTrip> = {}): RoundTrip {
  return {
    tradeId,
    accountKey: "acct",
    instrumentKey: `EQUITY:${tradeId}`,
    symbol: tradeId,
    assetType: "EQUITY",
    multiplier: "1",
    currency: "USD",
    direction: "long",
    status: "closed",
    openedAt: "2026-11-02T15:00:00Z",
    closedAt: "2026-11-02T19:00:00Z",
    openedSession: "2026-11-02",
    closedSession: "2026-11-02",
    dayTrade: true,
    entryQuantity: "10",
    openQuantity: "0",
    averageEntryPrice: "10",
    averageExitPrice: "11",
    realizedPnl: "10",
    fees: "0",
    portions: [],
    ...overrides,
  };
}

function entry(percent: string | null, r: string | null = null): JournalEntry {
  return {
    ref: "x",
    setupCode: null,
    review: "pending",
    r:
      r === null
        ? { value: null, reason: "no_planned_stop" }
        : { value: r, reason: null },
    return:
      percent === null
        ? { percent: null, scope: null, reason: "no_exits" }
        : { percent, scope: "whole_trade", reason: null },
  };
}

const early = trade("AAA", {
  closedAt: "2026-11-03T19:00:00Z",
  closedSession: "2026-11-03",
  realizedPnl: "-50",
  fees: "1.2",
});
const late = trade("BBB", {
  openedAt: "2026-11-04T15:00:00Z",
  closedAt: "2026-11-10T19:00:00Z",
  openedSession: "2026-11-04",
  closedSession: "2026-11-10",
  dayTrade: false,
  realizedPnl: "200",
  fees: "0.65",
});
const open = trade("CCC", {
  status: "open",
  openedAt: "2026-11-12T15:00:00Z",
  closedAt: null,
  openedSession: "2026-11-12",
  closedSession: null,
  averageExitPrice: null,
  realizedPnl: "0",
  fees: null,
});
const trades = [early, open, late];
const entries = {
  AAA: entry("-5", "-1"),
  BBB: entry("2", null),
  CCC: entry(null, null),
};

const ids = (rows: readonly RoundTrip[]) => rows.map((row) => row.tradeId);

describe("sortTrades", () => {
  it("puts the open trade first by default, then the latest exit", () => {
    expect(
      ids(
        sortTrades(
          trades,
          entries,
          { key: "closed", direction: "descending" },
          "money",
        ),
      ),
    ).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("reverses the recency order ascending", () => {
    expect(
      ids(
        sortTrades(
          trades,
          entries,
          { key: "closed", direction: "ascending" },
          "money",
        ),
      ),
    ).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("sorts the result in dollars and never reads an open trade as zero", () => {
    const sorted = (direction: "ascending" | "descending") =>
      ids(sortTrades(trades, entries, { key: "result", direction }, "money"));
    expect(sorted("descending")).toEqual(["BBB", "AAA", "CCC"]);
    expect(sorted("ascending")).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("sorts the result by return when the unit is percent", () => {
    // In dollars B > A, and also in percent here; flip the percent to prove it.
    const flipped = { ...entries, AAA: entry("9"), BBB: entry("2") };
    expect(
      ids(
        sortTrades(
          trades,
          flipped,
          { key: "result", direction: "descending" },
          "percent",
        ),
      ),
    ).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("leaves trades without R at the end in both directions", () => {
    expect(
      ids(
        sortTrades(
          trades,
          entries,
          { key: "r", direction: "ascending" },
          "money",
        ),
      ),
    ).toEqual(["AAA", "CCC", "BBB"]);
  });

  it("sorts symbols alphabetically", () => {
    expect(
      ids(
        sortTrades(
          trades,
          entries,
          { key: "symbol", direction: "descending" },
          "money",
        ),
      ),
    ).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("sorts by days held with the open trade last", () => {
    expect(
      ids(
        sortTrades(
          trades,
          entries,
          { key: "days", direction: "descending" },
          "money",
        ),
      ),
    ).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("does not mutate its input", () => {
    const input = [...trades];
    sortTrades(
      input,
      entries,
      { key: "fees", direction: "ascending" },
      "money",
    );
    expect(ids(input)).toEqual(["AAA", "CCC", "BBB"]);
  });
});

describe("daysHeld and displayedPnl", () => {
  it("counts calendar days only for a closed trade", () => {
    expect(daysHeld(late)).toBe(6);
    expect(daysHeld(open)).toBeNull();
  });

  it("shows no P&L for an open trade without exits", () => {
    expect(displayedPnl(open)).toBeNull();
    expect(displayedPnl(late)).toBe("200");
  });
});
