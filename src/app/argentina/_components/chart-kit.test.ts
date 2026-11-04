import { describe, expect, it } from "vitest";

import {
  axisLabel,
  axisReading,
  linearTicks,
  logTicks,
  nearestByY,
  readingPlacement,
  readingWidth,
  toPixel,
} from "./chart-kit";

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

describe("toPixel", () => {
  it("maps a value the way a fixed numeric axis does", () => {
    expect(toPixel(5, [0, 10], [100, 0])).toBe(50);
    expect(toPixel(-10, [-40, 40], [0, 80])).toBe(30);
    expect(toPixel(15, [0, 10], [0, 100])).toBe(150);
  });

  it("is linear in log10 on a log scale", () => {
    expect(toPixel(10, [1, 100], [0, 200], true)).toBeCloseTo(100);
    expect(toPixel(0, [1, 100], [0, 200], true)).toBeNull();
    expect(toPixel(10, [0, 100], [0, 200], true)).toBeNull();
  });

  it("has no position on a flat or non-finite domain", () => {
    expect(toPixel(1, [2, 2], [0, 100])).toBeNull();
    expect(toPixel(Number.NaN, [0, 1], [0, 100])).toBeNull();
  });
});

describe("nearestByY", () => {
  const points = [
    { key: "a", y: 40 },
    { key: "b", y: null },
    { key: "c", y: 120 },
  ];

  it("picks the placed point closest to the pointer", () => {
    expect(nearestByY(points, 100)?.key).toBe("c");
    expect(nearestByY(points, 10)?.key).toBe("a");
  });

  it("falls back to the first placed point without a pointer height", () => {
    expect(nearestByY(points, null)?.key).toBe("a");
    expect(nearestByY([{ key: "b", y: null }], 50)).toBeUndefined();
  });
});

describe("readingPlacement", () => {
  const plot = { x: 56, y: 8, width: 600, height: 240 };

  it("goes right of the point while it fits", () => {
    expect(
      readingPlacement({
        x: 100,
        y: 100,
        plot,
        width: 200,
        height: 60,
        gap: 14,
      }),
    ).toEqual({ left: 114, top: 70 });
  });

  it("flips left near the right edge", () => {
    expect(
      readingPlacement({
        x: 600,
        y: 100,
        plot,
        width: 200,
        height: 60,
        gap: 14,
      }),
    ).toEqual({ left: 386, top: 70 });
  });

  it("has no place when neither side fits", () => {
    const narrow = { x: 40, y: 8, width: 300, height: 200 };
    expect(
      readingPlacement({
        x: 200,
        y: 100,
        plot: narrow,
        width: 260,
        height: 60,
        gap: 28,
      }),
    ).toBeNull();
  });

  it("clamps vertically to the plot area", () => {
    expect(
      readingPlacement({ x: 100, y: 10, plot, width: 200, height: 60, gap: 14 })
        ?.top,
    ).toBe(8);
    expect(
      readingPlacement({
        x: 100,
        y: 245,
        plot,
        width: 200,
        height: 60,
        gap: 14,
      })?.top,
    ).toBe(188);
    expect(
      readingPlacement({
        x: 100,
        y: 100,
        plot,
        width: 200,
        height: 400,
        gap: 14,
      })?.top,
    ).toBe(8);
  });
});

describe("axisReading", () => {
  it("carries one more decimal than the ticks", () => {
    expect(axisLabel("index", 144.31)).toBe("144");
    expect(axisReading("index", 144.31)).toBe("144,3");
    expect(axisReading("millions", 5915)).toBe("5,92 mil");
    expect(axisReading("points", -21.06)).toBe("-21,1 %");
  });
});

describe("readingWidth", () => {
  it("fits the longest line between 160 and 288 px", () => {
    expect(readingWidth(["ene 2024"])).toBe(160);
    expect(readingWidth(["Base monetaria real  29.108.915"], 14)).toBe(240);
    expect(readingWidth(["x".repeat(80)])).toBe(288);
  });
});
