import { describe, expect, it } from "vitest";

import {
  calculateSoyBasis,
  soyBasisInputSchema,
  type SoyBasisInput,
} from "./soy-basis";

const on = "2026-11-02";
const early = "2026-11-03T10:00:00.000Z";
const late = "2026-11-03T18:00:00.000Z";

const sample: SoyBasisInput = {
  marketOn: on,
  knownAt: late,
  rosario: {
    marketOn: on,
    availableAt: early,
    sourceId: "bcr-cac-pizarra",
    value: "560000",
    unit: "ARS/t",
    delivery: "spot_rosario",
  },
  fx: {
    marketOn: on,
    availableAt: early,
    sourceId: "bna-fx",
    value: "1400",
    unit: "ARS/USD",
    side: "buyer",
    market: "BNA_divisas",
  },
  chicago: {
    marketOn: on,
    availableAt: early,
    sourceId: "chicago-contract",
    value: "10",
    unit: "USD/bushel",
    contract: "ZSX26",
    seriesKind: "single_contract",
    rollPolicy: null,
  },
};

describe("soy-basis-1.0.0", () => {
  it("converts the named contract and computes a positive Rosario premium", () => {
    const result = calculateSoyBasis(sample);
    expect(result).toMatchObject({
      status: "computed",
      rosarioUsdPerTon: "400",
      chicagoUsdPerTon: "367.437",
      chicagoContract: "ZSX26",
    });
    if (result.status !== "computed")
      throw new Error("expected computed basis");
    expect(Number(result.basisPct)).toBeCloseTo((400 / 367.437 - 1) * 100, 10);
  });

  it("computes a negative discount from an already converted contract", () => {
    expect(
      calculateSoyBasis({
        ...sample,
        chicago: {
          ...sample.chicago!,
          value: "500",
          unit: "USD/t",
          contract: "ZSF27",
          seriesKind: "continuous",
          rollPolicy: "five_sessions_before_expiry",
        },
      }),
    ).toMatchObject({
      status: "computed",
      basisPct: "-20",
      chicagoRollPolicy: "five_sessions_before_expiry",
    });
  });

  it.each([
    ["rosario", "missing_rosario"],
    ["fx", "missing_fx"],
    ["chicago", "missing_chicago"],
  ] as const)("names a missing %s quote", (field, reason) => {
    expect(calculateSoyBasis({ ...sample, [field]: null })).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("does not borrow yesterday's buyer FX", () => {
    expect(
      calculateSoyBasis({
        ...sample,
        fx: { ...sample.fx!, marketOn: "2026-10-30" },
      }),
    ).toEqual({ status: "unavailable", reason: "date_mismatch" });
  });

  it("does not use a quote published after the knowledge cutoff", () => {
    expect(
      calculateSoyBasis({
        ...sample,
        knownAt: early,
        chicago: { ...sample.chicago!, availableAt: late },
      }),
    ).toEqual({ status: "unavailable", reason: "not_yet_known" });
  });

  it("compares availability instants rather than timezone strings", () => {
    const result = calculateSoyBasis({
      ...sample,
      knownAt: "2026-11-03T12:00:00+03:00",
      chicago: { ...sample.chicago!, availableAt: "2026-11-03T09:30:00+00:00" },
    });
    expect(result).toEqual({ status: "unavailable", reason: "not_yet_known" });
  });

  it("requires a roll policy for a continuous Chicago series", () => {
    expect(() =>
      calculateSoyBasis({
        ...sample,
        chicago: {
          ...sample.chicago!,
          seriesKind: "continuous",
          rollPolicy: null,
        },
      }),
    ).toThrow("continuous series requires a roll policy");
  });

  it.each(["0", "-1"])("refuses a non-positive price or FX: %s", (value) => {
    expect(
      calculateSoyBasis({ ...sample, fx: { ...sample.fx!, value } }),
    ).toEqual({ status: "unavailable", reason: "non_positive_input" });
  });

  it("refuses a non-positive Chicago quote and a wrong Rosario currency", () => {
    expect(
      calculateSoyBasis({
        ...sample,
        chicago: { ...sample.chicago!, value: "0" },
      }),
    ).toEqual({ status: "unavailable", reason: "non_positive_input" });
    expect(
      soyBasisInputSchema.safeParse({
        ...sample,
        rosario: { ...sample.rosario!, unit: "USD/t" },
      }).success,
    ).toBe(false);
  });

  it.each(["NaN", "Infinity", "1e3"])(
    "refuses a non-finite or non-canonical input: %s",
    (value) => {
      expect(() =>
        calculateSoyBasis({
          ...sample,
          chicago: { ...sample.chicago!, value },
        }),
      ).toThrow("invalid_decimal");
    },
  );
});
