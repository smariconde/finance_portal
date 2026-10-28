import { describe, expect, it } from "vitest";

import { deriveGrowthTrajectory } from "./derived-growth-trajectory";

const history = [
  { fiscalYearEnd: "2026-09-03", value: "133188" },
  { fiscalYearEnd: "2025-09-04", value: "37378" },
  { fiscalYearEnd: "2024-09-05", value: "25111" },
  { fiscalYearEnd: "2023-09-07", value: "15540" },
];

describe("derived growth trajectory", () => {
  it("caps MU's extraordinary three-year CAGR at 30%", () => {
    const result = deriveGrowthTrajectory(history, "0.04");
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.trajectory.initialRevenueGrowth).toBe("0.3");
    expect(Number(result.trajectory.threeYearCagr)).toBeGreaterThan(1);
    expect(result.trajectory.explicitYears).toBe(10);
    expect(result.trajectory.highGrowthYears).toBe(3);
    expect(result.trajectory.marginConvergenceYears).toBe(5);
  });

  it("uses the CAGR when it is below the cap", () => {
    const result = deriveGrowthTrajectory(
      history.map((item, index) => ({
        ...item,
        value: String(1000 / 1.1 ** index),
      })),
      "0.02",
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(Number(result.trajectory.initialRevenueGrowth)).toBeCloseTo(0.1);
  });

  it.each([
    [history.slice(0, 3), "revenue_history_insufficient"],
    [
      history.map((item, index) =>
        index === 2 ? { ...item, value: "0" } : item,
      ),
      "revenue_history_non_positive",
    ],
    [
      history.map((item, index) =>
        index === 2 ? { ...item, value: "-1" } : item,
      ),
      "revenue_history_non_positive",
    ],
    [
      history.map((item, index) =>
        index === 2 ? { ...item, value: "NaN" } : item,
      ),
      "revenue_history_non_positive",
    ],
    [
      history.map((item, index) =>
        index === 2 ? { ...item, fiscalYearEnd: "2022-09-05" } : item,
      ),
      "revenue_history_discontinuous",
    ],
  ] as const)("refuses unusable revenue history %#", (values, reason) => {
    expect(deriveGrowthTrajectory(values, "0.02")).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("refuses a declining CAGR below terminal growth", () => {
    const falling = history.map((item, index) => ({
      ...item,
      value: String(100 / 1.1 ** (3 - index)),
    }));
    expect(deriveGrowthTrajectory(falling, "0.02")).toEqual({
      status: "unavailable",
      reason: "growth_below_terminal",
    });
  });

  it.each(["-0.01", "1.01", "Infinity"])(
    "refuses invalid terminal growth %s",
    (terminal) => {
      expect(deriveGrowthTrajectory(history, terminal)).toEqual({
        status: "unavailable",
        reason: "terminal_growth_invalid",
      });
    },
  );
});
