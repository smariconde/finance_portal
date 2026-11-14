import { describe, expect, it } from "vitest";

import { syntheticTrade } from "@/modules/trading/application/schwab-transaction-store.contract";

import { buildJournal } from "./journal";

function trade(id: string, quantity: string, net: string, time: string) {
  return syntheticTrade(id, {
    executedAt: time,
    netAmount: net,
    fees: "0.01",
    instrument: {
      instrumentId: "77",
      symbol: "SYN",
      assetType: "EQUITY",
      instrumentType: "COMMON_STOCK",
      description: null,
      quantity,
      price: "10",
      positionEffect: quantity.startsWith("-") ? "CLOSING" : "OPENING",
    },
  });
}

describe("buildJournal", () => {
  it("turns stored trades into round trips and a cumulative curve", () => {
    const { trades, summary } = buildJournal("acct", [
      trade("1", "10", "-100.01", "2026-11-09T15:00:00.000Z"),
      trade("2", "-10", "109.99", "2026-11-09T19:00:00.000Z"),
      trade("3", "5", "-50.01", "2026-11-10T15:00:00.000Z"),
      trade("4", "-5", "44.99", "2026-11-12T15:00:00.000Z"),
      trade("5", "1", "-10.01", "2026-11-13T15:00:00.000Z"),
      syntheticTrade("6", {
        type: "DIVIDEND_OR_INTEREST",
        instrument: null,
        fees: null,
        netAmount: "3",
      }),
    ]);

    expect(trades.map((t) => t.status)).toEqual(["closed", "closed", "open"]);
    expect(summary).toMatchObject({
      closed: 2,
      open: 1,
      winners: 1,
      losers: 1,
      dayTrades: 1,
      swingTrades: 1,
      realizedPnl: "4.96",
      fees: "0.05",
    });
    expect(summary.curve.map((p) => [p.pnl, p.cumulative])).toEqual([
      ["9.98", "9.98"],
      ["-5.02", "4.96"],
    ]);
  });

  it("ignores a withdrawn trade", () => {
    const { trades } = buildJournal("acct", [
      {
        ...trade("1", "10", "-100", "2026-11-09T15:00:00.000Z"),
        state: "withdrawn",
      },
    ]);
    expect(trades).toEqual([]);
  });

  it("is empty without trades", () => {
    expect(buildJournal("acct", []).summary).toMatchObject({
      closed: 0,
      realizedPnl: "0",
      curve: [],
    });
  });
});
