import { describe, expect, it } from "vitest";

import { cedearEquivalent } from "./cedear-equivalent";

const ratio = (depositaryUnits: string, underlyingUnits: string) => ({
  depositaryUnits,
  underlyingUnits,
});

describe("cedearEquivalent", () => {
  it("divides the value per share by the CEDEARs that make one share", () => {
    expect(
      cedearEquivalent({
        valuePerShare: "143.82",
        currency: "USD",
        ratio: ratio("20", "1"),
      }),
    ).toEqual({
      status: "computed",
      version: "cedear-equivalent-1.0.0",
      value: "7.191",
      currency: "USD",
    });
  });

  it("keeps the exact fraction when one CEDEAR is several shares", () => {
    const result = cedearEquivalent({
      valuePerShare: "10",
      currency: "USD",
      ratio: ratio("3", "2"),
    });

    expect(result.status === "computed" && result.value).toBe(
      "6.666666666666666666666666666666667",
    );
  });

  it("converts a negative value without changing its sign", () => {
    const result = cedearEquivalent({
      valuePerShare: "-5",
      currency: "USD",
      ratio: ratio("10", "1"),
    });

    expect(result.status === "computed" && result.value).toBe("-0.5");
  });

  it("converts a zero value to zero, because zero was computed", () => {
    const result = cedearEquivalent({
      valuePerShare: "0",
      currency: "USD",
      ratio: ratio("10", "1"),
    });

    expect(result.status === "computed" && result.value).toBe("0");
  });

  it("names a missing value per share instead of returning zero", () => {
    expect(
      cedearEquivalent({
        valuePerShare: null,
        currency: "USD",
        ratio: ratio("20", "1"),
      }),
    ).toMatchObject({ status: "unavailable", reason: "no_value_per_share" });
  });

  it("names a missing ratio", () => {
    expect(
      cedearEquivalent({ valuePerShare: "100", currency: "USD", ratio: null }),
    ).toMatchObject({ status: "unavailable", reason: "no_ratio" });
  });

  it("refuses a non-positive ratio", () => {
    expect(
      cedearEquivalent({
        valuePerShare: "100",
        currency: "USD",
        ratio: ratio("0", "1"),
      }),
    ).toMatchObject({ status: "unavailable", reason: "invalid_ratio" });
    expect(
      cedearEquivalent({
        valuePerShare: "100",
        currency: "USD",
        ratio: ratio("10", "-1"),
      }),
    ).toMatchObject({ status: "unavailable", reason: "invalid_ratio" });
  });

  it("refuses a non-finite value per share", () => {
    expect(() =>
      cedearEquivalent({
        valuePerShare: "Infinity",
        currency: "USD",
        ratio: ratio("10", "1"),
      }),
    ).toThrow();
  });
});
