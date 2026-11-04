import { describe, expect, it } from "vitest";

import { linearTicks, logTicks } from "./chart-kit";

describe("linearTicks", () => {
  it("covers the domain in round steps", () => {
    expect(linearTicks(0, 3.7)).toEqual([0, 1, 2, 3, 4]);
    expect(linearTicks(-0.6, 26.6)).toEqual([-10, 0, 10, 20, 30]);
    expect(linearTicks(700, 2100)).toEqual([500, 1000, 1500, 2000, 2500]);
    expect(linearTicks(24, 56)).toEqual([20, 30, 40, 50, 60]);
  });

  it("uses 2.5 steps and removes floating-point noise", () => {
    expect(linearTicks(0, 9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(linearTicks(0.1, 0.3)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3]);
  });

  it("pads a flat series and refuses a non-finite one", () => {
    expect(linearTicks(100, 100)).toEqual([90, 95, 100, 105, 110]);
    expect(linearTicks(Number.NaN, 1)).toEqual([]);
    expect(linearTicks(2, 1)).toEqual([]);
  });
});

describe("logTicks", () => {
  it("keeps only powers of ten when 1-2-5 would crowd the axis", () => {
    expect(logTicks(1, 100)).toEqual([1, 2, 5, 10, 20, 50, 100]);
    expect(logTicks(1, 10_000)).toEqual([1, 10, 100, 1000, 10_000]);
    expect(logTicks(0, 10)).toEqual([]);
  });
});
