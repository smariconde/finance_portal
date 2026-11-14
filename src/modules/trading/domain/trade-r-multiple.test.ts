import { describe, expect, it } from "vitest";

import { rMultipleOf, type RMultipleInput } from "./trade-r-multiple";

const long: RMultipleInput & { realizedPnl: string | null } = {
  direction: "long",
  currency: "USD",
  averageEntryPrice: "50",
  entryQuantity: "100",
  multiplier: "1",
  realizedPnl: "300",
};

const usd = (price: string) => ({ price, currency: "USD" });

describe("rMultipleOf", () => {
  it("divides the P&L by |entry − stop| × quantity × multiplier", () => {
    // Risk 1.50 × 100 = 150; 300 / 150 = 2R.
    expect(rMultipleOf(long, usd("48.5"))).toEqual({
      value: "2",
      reason: null,
    });
  });

  it("reads a loss as negative R", () => {
    expect(rMultipleOf({ ...long, realizedPnl: "-75" }, usd("48.5"))).toEqual({
      value: "-0.5",
      reason: null,
    });
  });

  it("is zero R for a breakeven trade, not null", () => {
    expect(rMultipleOf({ ...long, realizedPnl: "0" }, usd("48.5")).value).toBe(
      "0",
    );
  });

  it("takes a short's stop above the entry", () => {
    expect(
      rMultipleOf(
        { ...long, direction: "short", realizedPnl: "100" },
        usd("51"),
      ),
    ).toEqual({ value: "1", reason: null });
  });

  it("carries the option multiplier", () => {
    // 2 contracts × 100 × (1.20 − 0.80) = 80 of risk.
    expect(
      rMultipleOf(
        {
          ...long,
          averageEntryPrice: "1.2",
          entryQuantity: "2",
          multiplier: "100",
          realizedPnl: "120",
        },
        usd("0.8"),
      ),
    ).toEqual({ value: "1.5", reason: null });
  });

  it.each([
    ["no stop", long, null, "no_planned_stop"],
    ["unknown P&L", { ...long, realizedPnl: null }, usd("48"), "pnl_unknown"],
    [
      "no entry in the history",
      { ...long, averageEntryPrice: null },
      usd("48"),
      "entry_unknown",
    ],
    [
      "another currency",
      long,
      { price: "48", currency: "EUR" },
      "currency_mismatch",
    ],
    ["a long's stop above the entry", long, usd("52"), "stop_on_wrong_side"],
    [
      "a short's stop below the entry",
      { ...long, direction: "short" as const },
      usd("49"),
      "stop_on_wrong_side",
    ],
    ["a stop at the entry", long, usd("50"), "zero_risk"],
    ["no quantity", { ...long, entryQuantity: "0" }, usd("48"), "zero_risk"],
  ])("is null with a reason for %s", (_, trade, stop, reason) => {
    expect(rMultipleOf(trade, stop)).toEqual({ value: null, reason });
  });

  it("refuses a non-finite price", () => {
    expect(() => rMultipleOf(long, usd("NaN"))).toThrow();
  });
});
