import { describe, expect, it } from "vitest";

import { declaredIndecExpandedIndicator } from "./declared-indec-expanded-indicators";
import { ipcMonthlyInflation } from "./ipc-monthly-inflation";
import type { ArgentinaIndicatorVintage } from "./argentina-indicator";

const indicator = declaredIndecExpandedIndicator("ipc_nacional")!;
const point = (
  month: string,
  value: string | null,
): ArgentinaIndicatorVintage => ({
  indicatorId: indicator.id,
  periodOn: `${month}-01`,
  value,
  missingReason: value === null ? "source_null" : null,
  sourceNote: null,
  availableAt:
    month === "2026-10"
      ? "2026-11-12T12:00:00.000Z"
      : "2026-10-12T12:00:00.000Z",
  recordedAt: "2026-11-12T16:00:00.000Z",
  revision: 0,
  segment: indicator.segment,
  sourceRunId: "fixture",
});

describe("IPC national monthly index change", () => {
  const previous = point("2026-09", "100");
  const current = point("2026-10", "101.8");
  it("returns the monthly percentage and the later input availability", () => {
    expect(ipcMonthlyInflation({ indicator, previous, current })).toEqual({
      status: "computed",
      targetMonth: "2026-10",
      monthlyPercent: "1.8",
      availableAt: current.availableAt,
      version: "ipc-monthly-index-change-1.0.0",
    });
  });
  it("keeps missing, zero, negatives, non-finite and changed bases unavailable", () => {
    expect(
      ipcMonthlyInflation({ indicator, previous: null, current }),
    ).toMatchObject({ reason: "missing_period" });
    expect(
      ipcMonthlyInflation({
        indicator,
        previous,
        current: point("2026-10", null),
      }),
    ).toMatchObject({ reason: "missing_value" });
    for (const value of ["0", "-1", "Infinity"]) {
      expect(
        ipcMonthlyInflation({
          indicator,
          previous: point("2026-09", value),
          current,
        }),
      ).toMatchObject({ reason: "invalid_index" });
    }
    expect(
      ipcMonthlyInflation({
        indicator: { ...indicator, currency: "ARS" },
        previous,
        current,
      }),
    ).toMatchObject({ reason: "incompatible_basis" });
    expect(
      ipcMonthlyInflation({
        indicator,
        previous: point("2026-08", "100"),
        current,
      }),
    ).toMatchObject({ reason: "incompatible_basis" });
  });
});
