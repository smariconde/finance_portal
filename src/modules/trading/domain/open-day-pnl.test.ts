import { describe, expect, it } from "vitest";

import { dayTotal, openDayPnl } from "./open-day-pnl";
import type { SchwabPosition } from "./schwab-account";

function position(
  dayProfitLoss: string | null,
  openProfitLoss: string | null,
  side: SchwabPosition["side"] = "long",
): SchwabPosition {
  return {
    symbol: "SYN",
    assetType: "EQUITY",
    description: null,
    side,
    quantity: "10",
    averagePrice: "100",
    marketValue: "1000",
    dayProfitLoss,
    dayProfitLossPercent: null,
    openProfitLoss,
    optionMultiplier: null,
  };
}

describe("openDayPnl", () => {
  it("sums Schwab's figures of the open positions", () => {
    expect(
      openDayPnl([position("-3.2", "10"), position("1.25", "-0.5", "short")]),
    ).toEqual({
      positions: 2,
      day: { value: "-1.95", missing: 0 },
      open: { value: "9.5", missing: 0 },
    });
  });

  it("leaves a flat position out", () => {
    expect(openDayPnl([position(null, null, "flat")]).positions).toBe(0);
  });

  it("is zero with nothing open: there is nothing to lose today", () => {
    expect(openDayPnl([]).day).toEqual({ value: "0", missing: 0 });
  });

  it("is null with the count when a position lacks its figure", () => {
    expect(openDayPnl([position(null, "1"), position("2", "1")]).day).toEqual({
      value: null,
      missing: 1,
    });
  });
});

describe("dayTotal", () => {
  it("adds the realized and the open day", () => {
    expect(dayTotal("120.5", { value: "-20.25", missing: 0 })).toBe("100.25");
  });

  it("has no total without the open figure", () => {
    expect(dayTotal("120.5", { value: null, missing: 1 })).toBeNull();
  });

  it("refuses a non-finite amount", () => {
    expect(() => dayTotal("Infinity", { value: "0", missing: 0 })).toThrow();
  });
});
