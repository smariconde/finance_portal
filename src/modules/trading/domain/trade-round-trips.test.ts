import { describe, expect, it } from "vitest";

import {
  buildRoundTrips,
  RoundTripError,
  type TradeFill,
} from "./trade-round-trips";
import { tradingSessionOf } from "./trading-session";

let sequence = 0;

function fill(
  side: "buy" | "sell",
  quantity: string,
  price: string,
  netAmount: string,
  executedAt: string,
  extra: Partial<TradeFill> = {},
): TradeFill {
  sequence += 1;
  return {
    fillId: String(sequence),
    accountKey: "acct",
    instrumentKey: "EQUITY:SYN",
    symbol: "SYN",
    assetType: "EQUITY",
    multiplier: "1",
    currency: "USD",
    side,
    quantity,
    price,
    netAmount,
    fees: "0",
    executedAt,
    positionEffect: side === "buy" ? "opening" : "closing",
    ...extra,
  };
}

// 2026-11-13 is a Friday in EST: 14:30Z is 9:30 in New York.
const MON = "2026-11-09T15:00:00Z";
const MON_LATER = "2026-11-09T19:00:00Z";
const TUE = "2026-11-10T15:00:00Z";
const WED = "2026-11-11T15:00:00Z";

describe("tradingSessionOf", () => {
  it("dates by the New York clock, not UTC", () => {
    // 01:30 UTC on the 14th is 20:30 on the 13th in New York.
    expect(tradingSessionOf("2026-11-14T01:30:00Z")).toBe("2026-11-13");
    expect(tradingSessionOf("2026-11-13T14:30:00Z")).toBe("2026-11-13");
  });
});

describe("buildRoundTrips (golden)", () => {
  it("a long day trade realizes exactly the sum of its net amounts", () => {
    const [trade] = buildRoundTrips([
      fill("buy", "100", "10.00", "-1000.65", MON, { fees: "0.65" }),
      fill("sell", "100", "10.50", "1049.35", MON_LATER, { fees: "0.65" }),
    ]);
    expect(trade).toMatchObject({
      direction: "long",
      status: "closed",
      dayTrade: true,
      entryQuantity: "100",
      openQuantity: "0",
      averageEntryPrice: "10",
      averageExitPrice: "10.5",
      realizedPnl: "48.7",
      fees: "1.3",
    });
  });

  it("a short swing trade", () => {
    const [trade] = buildRoundTrips([
      fill("sell", "50", "20", "999.99", MON, { positionEffect: "opening" }),
      fill("buy", "50", "18", "-900.01", WED, { positionEffect: "closing" }),
    ]);
    expect(trade).toMatchObject({
      direction: "short",
      dayTrade: false,
      openedSession: "2026-11-09",
      closedSession: "2026-11-11",
      realizedPnl: "99.98",
    });
  });

  it("scales in, exits in parts, and realizes FIFO while open", () => {
    const trades = buildRoundTrips([
      fill("buy", "10", "100", "-1000", MON),
      fill("buy", "10", "110", "-1100", MON_LATER),
      // Closes the first lot (cost 1000) for 1200: +200 realized.
      fill("sell", "10", "120", "1200", TUE),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      status: "open",
      openQuantity: "10",
      entryQuantity: "20",
      averageEntryPrice: "105",
      realizedPnl: "200",
      closedAt: null,
      dayTrade: false,
    });
  });

  it("splits a fill that flips from long to short, cents exact", () => {
    const trades = buildRoundTrips([
      fill("buy", "3", "10", "-30", MON),
      // Sells 3 to close and 4 to open short; 70.01 does not split evenly.
      fill("sell", "7", "10", "70.01", TUE, { positionEffect: null }),
      fill("buy", "4", "9", "-36", WED, { positionEffect: "closing" }),
    ]);
    expect(trades).toHaveLength(2);
    const [long, short] = trades;
    expect(long).toMatchObject({ direction: "long", realizedPnl: "0" });
    expect(long!.portions.at(-1)).toMatchObject({
      quantity: "3",
      netAmount: "30",
    });
    expect(short).toMatchObject({
      direction: "short",
      status: "closed",
      realizedPnl: "4.01",
    });
    // The two parts of the flipping fill add back to its net amount.
    expect(
      Number(long!.portions.at(-1)!.netAmount) +
        Number(short!.portions[0]!.netAmount),
    ).toBeCloseTo(70.01, 10);
    expect(short!.portions[0]).toMatchObject({ netAmount: "40.01" });
  });

  it("keeps options apart and carries the multiplier without rescaling", () => {
    const option = {
      instrumentKey: "OPTION:SYN 261218C00100000",
      symbol: "SYN 261218C00100000",
      assetType: "OPTION",
      multiplier: "100",
    };
    const trades = buildRoundTrips([
      fill("buy", "2", "1.25", "-251.30", MON, option),
      fill("buy", "100", "10", "-1000", MON),
      fill("sell", "2", "1.80", "358.70", TUE, option),
    ]);
    const call = trades.find((t) => t.assetType === "OPTION")!;
    expect(call).toMatchObject({
      multiplier: "100",
      realizedPnl: "107.4",
      status: "closed",
    });
    expect(trades.find((t) => t.assetType === "EQUITY")).toMatchObject({
      status: "open",
    });
  });

  it("orders fills by execution, whatever order they arrive in", () => {
    const sell = fill("sell", "1", "11", "11", TUE);
    const buy = fill("buy", "1", "10", "-10", MON);
    expect(buildRoundTrips([sell, buy])[0]).toMatchObject({
      direction: "long",
      realizedPnl: "1",
    });
  });

  it("leaves fees null when one fill does not separate them", () => {
    const [trade] = buildRoundTrips([
      fill("buy", "1", "10", "-10", MON),
      fill("sell", "1", "11", "11", TUE, { fees: null }),
    ]);
    expect(trade!.fees).toBeNull();
  });

  it("matches per account", () => {
    const trades = buildRoundTrips([
      fill("buy", "1", "10", "-10", MON),
      fill("sell", "1", "11", "11", TUE, {
        accountKey: "other",
        positionEffect: "opening",
      }),
    ]);
    expect(trades.map((t) => t.direction)).toEqual(["long", "short"]);
  });

  it("never reads a closing sell without its entry as a short", () => {
    const trades = buildRoundTrips([
      fill("sell", "5", "30", "149.98", MON),
      fill("buy", "2", "31", "-62", TUE),
    ]);
    expect(trades[0]).toMatchObject({
      status: "opened_before_history",
      direction: "long",
      realizedPnl: null,
      averageEntryPrice: null,
    });
    expect(trades[1]).toMatchObject({ direction: "long", status: "open" });
  });

  it("closes what it can and leaves the excess before the history", () => {
    const trades = buildRoundTrips([
      fill("buy", "2", "10", "-20", MON),
      fill("sell", "5", "12", "60", TUE),
    ]);
    expect(trades.map((t) => [t.status, t.realizedPnl])).toEqual([
      ["closed", "4"],
      ["opened_before_history", null],
    ]);
    expect(trades[1]!.portions[0]).toMatchObject({
      quantity: "3",
      netAmount: "36",
    });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
  ])("refuses a %s quantity", (_, quantity) => {
    expect(() =>
      buildRoundTrips([fill("buy", quantity, "10", "-10", MON)]),
    ).toThrow(RoundTripError);
  });

  it("refuses a currency change inside an open trade", () => {
    expect(() =>
      buildRoundTrips([
        fill("buy", "1", "10", "-10", MON),
        fill("sell", "1", "11", "11", TUE, { currency: "EUR" }),
      ]),
    ).toThrow(/currency/u);
  });

  it("refuses a non-finite amount", () => {
    expect(() => buildRoundTrips([fill("buy", "1", "10", "NaN", MON)])).toThrow(
      RoundTripError,
    );
  });
});
