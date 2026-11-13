import { describe, expect, it } from "vitest";

import { remInflationError } from "./rem-inflation-error";

const forecast = {
  targetMonth: "2026-10",
  medianPercent: "1.8",
  availableAt: "2026-11-05T00:00:00Z",
  unit: "percent_monthly",
};
const actual = {
  targetMonth: "2026-10",
  monthlyPercent: "2.2",
  availableAt: "2026-11-12T00:00:00Z",
  unit: "percent_monthly",
};
const input = { knownAt: "2026-11-13T00:00:00Z", forecast, actual };

describe("rem-inflation-error-1.0.0", () => {
  it("subtracts the published REM median from the matching observed IPC in pp", () => {
    expect(remInflationError(input)).toEqual({
      status: "computed",
      targetMonth: "2026-10",
      errorPp: "0.4",
    });
    expect(
      remInflationError({
        ...input,
        forecast: { ...forecast, medianPercent: "0" },
        actual: { ...actual, monthlyPercent: "-0.2" },
      }),
    ).toMatchObject({ errorPp: "-0.2" });
  });

  it("refuses unknown, late, mismatched and non-finite inputs", () => {
    const cases = [
      [{ ...input, forecast: null }, "missing_forecast"],
      [{ ...input, actual: null }, "missing_actual"],
      [
        { ...input, forecast: { ...forecast, medianPercent: null } },
        "missing_forecast",
      ],
      [
        { ...input, actual: { ...actual, targetMonth: "2026-09" } },
        "period_mismatch",
      ],
      [{ ...input, forecast: { ...forecast, unit: "ARS" } }, "unit_mismatch"],
      [{ ...input, knownAt: "2026-11-06T00:00:00Z" }, "not_yet_known"],
      [
        {
          ...input,
          forecast: { ...forecast, availableAt: actual.availableAt },
        },
        "forecast_after_actual",
      ],
      [
        { ...input, actual: { ...actual, monthlyPercent: "Infinity" } },
        "invalid_value",
      ],
    ] as const;
    for (const [caseInput, reason] of cases) {
      expect(remInflationError(caseInput)).toEqual({
        status: "unavailable",
        reason,
      });
    }
  });
});
