import { describe, expect, it } from "vitest";

import { accountDayChange, positionOpenReturn } from "./live-account-figures";

describe("accountDayChange", () => {
  it("is liquidation value now minus at the open, with its percent", () => {
    expect(
      accountDayChange({
        liquidationValue: "10250.5",
        liquidationValueAtOpen: "10000",
        cashFlows: "0",
      }),
    ).toEqual({ amount: "250.5", percent: "2.505", net: true });
  });

  it("keeps the sign of a losing day", () => {
    expect(
      accountDayChange({
        liquidationValue: "9900",
        liquidationValueAtOpen: "10000",
        cashFlows: "0",
      }),
    ).toEqual({ amount: "-100", percent: "-1", net: true });
  });

  it("does not read a deposit as a gain nor a withdrawal as a loss", () => {
    expect(
      accountDayChange({
        liquidationValue: "10590",
        liquidationValueAtOpen: "10000",
        cashFlows: "590",
      }),
    ).toEqual({ amount: "0", percent: "0", net: true });
    expect(
      accountDayChange({
        liquidationValue: "9900",
        liquidationValueAtOpen: "10000",
        cashFlows: "-145",
      }),
    ).toEqual({ amount: "45", percent: "0.45", net: true });
  });

  it("says the change is gross when the cash flows are unknown", () => {
    expect(
      accountDayChange({
        liquidationValue: "10590",
        liquidationValueAtOpen: "10000",
        cashFlows: null,
      }),
    ).toEqual({ amount: "590", percent: "5.9", net: false });
  });

  it("has no percent without a positive value at the open", () => {
    expect(
      accountDayChange({
        liquidationValue: "100",
        liquidationValueAtOpen: "0",
        cashFlows: "100",
      }),
    ).toEqual({ amount: "0", percent: null, net: true });
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
