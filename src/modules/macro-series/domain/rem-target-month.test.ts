import { describe, expect, it } from "vitest";

import { remTargetMonthState } from "./rem-target-month";

describe("rem-target-month-1.0.0", () => {
  it("names a month that ended, the running one and the ones to come", () => {
    const now = "2026-11-26T15:00:00.000Z";
    expect(remTargetMonthState("2026-10", now)).toBe("closed");
    expect(remTargetMonthState("2026-11", now)).toBe("current");
    expect(remTargetMonthState("2026-12", now)).toBe("future");
    expect(remTargetMonthState("2027-01", now)).toBe("future");
  });

  it("reads the month in Buenos Aires, not in UTC", () => {
    // 1 December 01:00 UTC is still 30 November in Buenos Aires.
    expect(remTargetMonthState("2026-11", "2026-12-01T01:00:00.000Z")).toBe(
      "current",
    );
    expect(remTargetMonthState("2026-11", "2026-12-01T03:00:00.000Z")).toBe(
      "closed",
    );
  });

  it("refuses a malformed month or instant instead of guessing", () => {
    expect(() =>
      remTargetMonthState("2026-13", "2026-11-26T15:00:00Z"),
    ).toThrow("invalid_target_month");
    expect(() => remTargetMonthState("2026-11", "ayer")).toThrow(
      "invalid_known_at",
    );
  });
});
