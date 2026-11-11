import { describe, expect, it } from "vitest";

import { wholesaleBandPosition } from "./wholesale-band-position";

const on = "2026-11-06";

describe("wholesaleBandPosition", () => {
  it("measures position and signed distances without rounding the calculation", () => {
    expect(
      wholesaleBandPosition({
        on,
        official: "1250",
        low: "1000",
        high: "1500",
      }),
    ).toEqual({
      status: "computed",
      on,
      position: "0.5",
      toFloor: "250",
      toCeiling: "250",
      official: "1250",
      low: "1000",
      high: "1500",
    });
  });

  it("preserves prices below and above the band", () => {
    expect(
      wholesaleBandPosition({ on, official: "900", low: "1000", high: "1500" }),
    ).toMatchObject({
      status: "computed",
      position: "-0.2",
      toFloor: "-100",
      toCeiling: "600",
    });
    expect(
      wholesaleBandPosition({
        on,
        official: "1600",
        low: "1000",
        high: "1500",
      }),
    ).toMatchObject({
      status: "computed",
      position: "1.2",
      toFloor: "600",
      toCeiling: "-100",
    });
  });

  it("names missing quotes, zero width, reversed and invalid values", () => {
    expect(
      wholesaleBandPosition({
        on: null,
        official: null,
        low: null,
        high: null,
      }),
    ).toMatchObject({ reason: "missing_official" });
    expect(
      wholesaleBandPosition({ on, official: "1000", low: null, high: "1500" }),
    ).toMatchObject({ reason: "missing_same_day_band" });
    for (const high of ["1000", "900"]) {
      expect(
        wholesaleBandPosition({ on, official: "1000", low: "1000", high }),
      ).toMatchObject({ reason: "invalid_band" });
    }
    expect(
      wholesaleBandPosition({ on, official: "NaN", low: "1000", high: "1500" }),
    ).toMatchObject({ reason: "invalid_value" });
    expect(
      wholesaleBandPosition({
        on,
        official: "Infinity",
        low: "1000",
        high: "1500",
      }),
    ).toMatchObject({ reason: "invalid_value" });
    expect(
      wholesaleBandPosition({ on, official: "-100", low: "-200", high: "0" }),
    ).toMatchObject({
      status: "computed",
      position: "0.5",
    });
  });
});
