import { describe, expect, it } from "vitest";

import { accountDayChange, positionOpenReturn } from "./live-account-figures";

describe("accountDayChange", () => {
  it("is liquidation value now minus at the open, with its percent", () => {
    expect(
      accountDayChange({
        liquidationValue: "10250.5",
        liquidationValueAtOpen: "10000",
      }),
    ).toEqual({ amount: "250.5", percent: "2.505" });
  });

  it("keeps the sign of a losing day", () => {
    expect(
      accountDayChange({
        liquidationValue: "9900",
        liquidationValueAtOpen: "10000",
      }),
    ).toEqual({ amount: "-100", percent: "-1" });
  });

  it("has no percent without a positive value at the open", () => {
    expect(
      accountDayChange({
        liquidationValue: "100",
        liquidationValueAtOpen: "0",
      }),
    ).toEqual({ amount: "100", percent: null });
  });
});

describe("positionOpenReturn", () => {
  const position = {
    averagePrice: "50",
    quantity: "100",
    openProfitLoss: "500",
    optionMultiplier: null,
  };

  it("is the open P&L over the cost", () => {
    expect(positionOpenReturn(position)).toBe("10");
    expect(positionOpenReturn({ ...position, openProfitLoss: "-250" })).toBe(
      "-5",
    );
  });

  it("is null without a P&L, without a cost or for an option", () => {
    expect(
      positionOpenReturn({ ...position, openProfitLoss: null }),
    ).toBeNull();
    expect(positionOpenReturn({ ...position, averagePrice: "0" })).toBeNull();
    expect(
      positionOpenReturn({ ...position, optionMultiplier: "100" }),
    ).toBeNull();
  });
});
