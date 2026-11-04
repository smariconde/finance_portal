import { describe, expect, it } from "vitest";

import {
  daysBetween,
  monthEndCloses,
  monthsBetween,
  pointChange,
} from "./chart-history";

describe("month-end-close-1.0.0", () => {
  it("reads each month at its last published day and names the day", () => {
    expect(
      monthEndCloses([
        { on: "2026-01-02", value: "10" },
        { on: "2026-01-30", value: "11" },
        { on: "2026-01-31", value: null },
        { on: "2026-02-27", value: "12" },
      ]),
    ).toEqual([
      { on: "2026-01-01", closeOn: "2026-01-30", value: "11" },
      { on: "2026-02-01", closeOn: "2026-02-27", value: "12" },
    ]);
  });

  it("keeps a month without a close as null instead of joining neighbours", () => {
    const closes = monthEndCloses([
      { on: "2026-01-30", value: "1" },
      { on: "2026-03-31", value: "3" },
    ]);
    expect(closes.map((close) => [close.on, close.value])).toEqual([
      ["2026-01-01", "1"],
      ["2026-02-01", null],
      ["2026-03-01", "3"],
    ]);
  });

  it("returns nothing for a series with no published value", () => {
    expect(monthEndCloses([{ on: "2026-01-02", value: null }])).toEqual([]);
    expect(monthEndCloses([])).toEqual([]);
  });

  it("counts months across a year boundary", () => {
    expect(monthsBetween("2025-11-15", "2026-02-03")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });
});

describe("point-change-1.0.0", () => {
  it("reads a level by its ratio and a rate by its difference", () => {
    expect(pointChange("1000", "1250", "ratio")).toEqual({
      status: "computed",
      value: "0.25",
    });
    expect(pointChange("0.07", "0.031", "difference")).toEqual({
      status: "computed",
      value: "-0.039",
    });
  });

  it("refuses a ratio from a zero or negative base", () => {
    expect(pointChange("0", "5", "ratio")).toEqual({
      status: "unavailable",
      reason: "non_positive_base",
    });
    expect(pointChange("-200", "300", "ratio")).toEqual({
      status: "unavailable",
      reason: "non_positive_base",
    });
    expect(pointChange("-200", "300", "difference")).toEqual({
      status: "computed",
      value: "500",
    });
  });

  it("names a missing endpoint", () => {
    expect(pointChange(null, "1", "ratio")).toEqual({
      status: "unavailable",
      reason: "missing_value",
    });
    expect(pointChange("1", null, "difference")).toMatchObject({
      status: "unavailable",
    });
  });

  it("counts calendar days", () => {
    expect(daysBetween("2023-12-10", "2024-12-10")).toBe(366);
  });
});
