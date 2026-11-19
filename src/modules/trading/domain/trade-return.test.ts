import { describe, expect, it } from "vitest";

import { tradeReturnOf } from "./trade-return";
import { buildRoundTrips, type TradeFill } from "./trade-round-trips";

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

const MON = "2026-11-09T15:00:00Z";
const MON_LATER = "2026-11-09T19:00:00Z";
const TUE = "2026-11-10T15:00:00Z";
const WED = "2026-11-11T15:00:00Z";

describe("tradeReturnOf", () => {
  it("divides a closed long's P&L by what its entries cost, fees included", () => {
    const [trade] = buildRoundTrips([
      fill("buy", "100", "10.00", "-1000.65", MON, { fees: "0.65" }),
      fill("sell", "100", "10.50", "1049.35", MON_LATER, { fees: "0.65" }),
    ]);
    // 48.70 / 1000.65, computed with Python Decimal: 4.8668365562384450107…
    const result = tradeReturnOf(trade!);
    expect(result.reason).toBeNull();
    expect(result.scope).toBe("whole_trade");
    expect(result.percent!.startsWith("4.86683655623844501074")).toBe(true);
  });

  it("measures a short against what its sale collected", () => {
    const [trade] = buildRoundTrips([
      fill("sell", "50", "20", "1000", MON, { positionEffect: "opening" }),
      fill("buy", "50", "18", "-900", WED, { positionEffect: "closing" }),
    ]);
    expect(tradeReturnOf(trade!)).toEqual({
      percent: "10",
      scope: "whole_trade",
      reason: null,
    });
  });

  it("is negative for a loss and zero for breakeven, never null", () => {
    const [loss] = buildRoundTrips([
      fill("buy", "10", "50", "-500", MON),
      fill("sell", "10", "45", "450", TUE),
    ]);
    expect(tradeReturnOf(loss!).percent).toBe("-10");

    const [flat] = buildRoundTrips([
      fill("buy", "10", "50", "-500", MON),
      fill("sell", "10", "50", "500", TUE),
    ]);
    expect(tradeReturnOf(flat!).percent).toBe("0");
  });

  it("weighs every exit of a scaled trade by its own FIFO cost", () => {
    // Lots: 100 @ 10 and 100 @ 12 → total cost 2200. Exits: 120 @ 13, 80 @ 9.
    const [trade] = buildRoundTrips([
      fill("buy", "100", "10", "-1000", MON),
      fill("buy", "100", "12", "-1200", MON_LATER),
      fill("sell", "120", "13", "1560", TUE),
      fill("sell", "80", "9", "720", WED),
    ]);
    // P&L 80 over 2200 of cost.
    expect(trade!.realizedPnl).toBe("80");
    expect(tradeReturnOf(trade!).percent!.startsWith("3.636363")).toBe(true);
  });

  it("reads an open trade's partial exit against the cost of what left", () => {
    // 100 @ 10 then 100 @ 20; selling 100 @ 15 consumes the first lot (FIFO).
    const [trade] = buildRoundTrips([
      fill("buy", "100", "10", "-1000", MON),
      fill("buy", "100", "20", "-2000", MON_LATER),
      fill("sell", "100", "15", "1500", TUE),
    ]);
    expect(trade!.status).toBe("open");
    expect(tradeReturnOf(trade!)).toEqual({
      percent: "50",
      scope: "exited_portion",
      reason: null,
    });
  });

  it("carries an option's multiplier through the net amounts", () => {
    const option = {
      instrumentKey: "OPTION:SYN",
      assetType: "OPTION",
      multiplier: "100",
    };
    const [trade] = buildRoundTrips([
      fill("buy", "2", "1.20", "-240", MON, option),
      fill("sell", "2", "1.80", "360", TUE, option),
    ]);
    expect(tradeReturnOf(trade!).percent).toBe("50");
  });

  it("has no return without exits", () => {
    const [trade] = buildRoundTrips([fill("buy", "10", "50", "-500", MON)]);
    expect(tradeReturnOf(trade!)).toEqual({
      percent: null,
      scope: null,
      reason: "no_exits",
    });
  });

  it("has no return for a trade opened before the history", () => {
    const [trade] = buildRoundTrips([fill("sell", "10", "50", "500", MON)]);
    expect(trade!.status).toBe("opened_before_history");
    expect(tradeReturnOf(trade!)).toEqual({
      percent: null,
      scope: null,
      reason: "entry_unknown",
    });
  });

  it("refuses a zero basis instead of dividing by it", () => {
    expect(
      tradeReturnOf({
        status: "closed",
        portions: [
          { role: "open", netAmount: "0", realizedPnl: null },
          { role: "close", netAmount: "0", realizedPnl: "0" },
        ],
      }),
    ).toEqual({ percent: null, scope: null, reason: "zero_basis" });
  });

  it("rejects a non-finite amount instead of reading it", () => {
    expect(() =>
      tradeReturnOf({
        status: "closed",
        portions: [{ role: "close", netAmount: "NaN", realizedPnl: "1" }],
      }),
    ).toThrow();
  });
});
