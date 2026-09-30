import { describe, expect, it } from "vitest";

import {
  calendarDaysBetween,
  subtractCalendarYears,
  subtractDays,
} from "./calendar-date";

describe("calendar arithmetic", () => {
  it("moves whole years and clamps the 29th of February", () => {
    expect(subtractCalendarYears("2025-09-27", 5)).toBe("2020-09-27");
    expect(subtractCalendarYears("2024-02-29", 5)).toBe("2019-02-28");
    expect(subtractCalendarYears("2028-02-29", 4)).toBe("2024-02-29");
    expect(subtractCalendarYears("2025-12-31", 6)).toBe("2019-12-31");
  });

  it("moves days across months and leap days", () => {
    expect(subtractDays("2020-09-27", 14)).toBe("2020-09-13");
    expect(subtractDays("2020-03-10", 14)).toBe("2020-02-25");
    expect(subtractDays("2021-01-11", 14)).toBe("2020-12-28");
  });

  it("counts calendar days in either direction", () => {
    expect(calendarDaysBetween("2024-06-07", "2024-06-10")).toBe(3);
    expect(calendarDaysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(calendarDaysBetween("2024-06-10", "2024-06-07")).toBe(-3);
    expect(calendarDaysBetween("2024-06-10", "2024-06-10")).toBe(0);
  });

  it("refuses text that is not a calendar date", () => {
    expect(() => subtractCalendarYears("2025-02-30", 5)).toThrow(TypeError);
    expect(() => subtractDays("20250101", 1)).toThrow(TypeError);
    expect(() => calendarDaysBetween("2025-01-01", "2025-13-01")).toThrow(
      TypeError,
    );
  });
});
