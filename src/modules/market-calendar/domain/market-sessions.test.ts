import { describe, expect, it } from "vitest";

import {
  NYSE_CALENDAR,
  type MarketCalendarDeclaration,
} from "./declared-market-sessions";
import {
  calendarCoverage,
  hoursAheadOfNewYork,
  marketDayOf,
  marketDaysBetween,
  marketMomentAt,
  nextClockShift,
  nextTradingDayAfter,
} from "./market-sessions";
import { instantAt, isoWeekday } from "./zoned-time";

describe("NYSE_CALENDAR", () => {
  it("declares weekdays inside its coverage, once each", () => {
    const dates = [
      ...NYSE_CALENDAR.holidays.map((holiday) => holiday.date),
      ...NYSE_CALENDAR.earlyCloses.map((early) => early.date),
    ];
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates) {
      expect(isoWeekday(date)).toBeLessThanOrEqual(5);
      expect(date >= NYSE_CALENDAR.coversFrom).toBe(true);
      expect(date <= NYSE_CALENDAR.coversTo).toBe(true);
    }
  });

  it("holds the ten holidays a year the NYSE announced, nine in 2028", () => {
    const perYear = (year: string) =>
      NYSE_CALENDAR.holidays.filter((holiday) => holiday.date.startsWith(year))
        .length;
    expect([perYear("2026"), perYear("2027"), perYear("2028")]).toEqual([
      10, 10, 9,
    ]);
  });
});

describe("marketDayOf", () => {
  it("closes on Thanksgiving 2026 with its official name", () => {
    expect(marketDayOf("2026-11-26")).toMatchObject({
      status: "holiday",
      note: "Thanksgiving Day",
      regular: null,
    });
  });

  it("closes early the day after, at 13:00 New York and 15:00 Buenos Aires", () => {
    const day = marketDayOf("2026-11-27");
    expect(day.status).toBe("early_close");
    expect(day.regular?.close).toEqual({
      instant: "2026-11-27T18:00:00.000Z",
      newYork: "13:00",
      buenosAires: "15:00",
    });
    expect(day.regular?.open.buenosAires).toBe("11:30");
  });

  it("opens at 10:30 Buenos Aires under US daylight time", () => {
    const day = marketDayOf("2026-07-15");
    expect(day.status).toBe("open");
    expect(day.regular?.open).toEqual({
      instant: "2026-07-15T13:30:00.000Z",
      newYork: "09:30",
      buenosAires: "10:30",
    });
    expect(day.regular?.close.buenosAires).toBe("17:00");
  });

  it("does not observe New Year's Day in 2028, a Saturday", () => {
    expect(marketDayOf("2028-01-01").status).toBe("weekend");
    expect(marketDayOf("2027-12-31").status).toBe("open");
  });

  it("observes Christmas 2027 on Friday the 24th", () => {
    expect(marketDayOf("2027-12-24")).toMatchObject({
      status: "holiday",
      note: "Christmas Day (observed)",
    });
  });

  it("names weekends and refuses to assume a session outside the declaration", () => {
    expect(marketDayOf("2026-11-28").status).toBe("weekend");
    expect(marketDayOf("2029-01-02")).toMatchObject({
      status: "undeclared",
      regular: null,
    });
    expect(marketDayOf("2025-12-31").status).toBe("undeclared");
  });

  it("reads another declaration when given one", () => {
    const calendar: MarketCalendarDeclaration = {
      ...NYSE_CALENDAR,
      holidays: [{ date: "2026-12-01", name: "National Day of Mourning" }],
      earlyCloses: [],
    };
    expect(marketDayOf("2026-12-01", calendar).status).toBe("holiday");
    expect(marketDayOf("2026-11-26", calendar).status).toBe("open");
  });

  it("rejects what is not a calendar date", () => {
    expect(() => marketDayOf("2026-02-30")).toThrow(TypeError);
  });
});

describe("marketDaysBetween and nextTradingDayAfter", () => {
  it("lists Thanksgiving week day by day", () => {
    expect(
      marketDaysBetween("2026-11-23", "2026-11-29").map((day) => day.status),
    ).toEqual([
      "open",
      "open",
      "open",
      "holiday",
      "early_close",
      "weekend",
      "weekend",
    ]);
  });

  it("skips the holiday and the weekend", () => {
    expect(nextTradingDayAfter("2026-11-25")?.date).toBe("2026-11-27");
    expect(nextTradingDayAfter("2026-12-24")?.date).toBe("2026-12-28");
  });

  it("returns null when the declaration runs out first", () => {
    expect(nextTradingDayAfter("2028-12-29")).toBeNull();
  });
});

describe("marketMomentAt", () => {
  it("is a closed day on Thanksgiving, opening next on the early close", () => {
    const moment = marketMomentAt("2026-11-26T15:00:00.000Z");
    expect(moment.phase).toBe("closed_day");
    expect(moment.nextOpen?.date).toBe("2026-11-27");
  });

  it("uses the New York date: 01:00 in Buenos Aires is still yesterday there", () => {
    const moment = marketMomentAt("2026-11-25T04:00:00.000Z");
    expect(moment.today.date).toBe("2026-11-24");
    expect(moment.phase).toBe("after_close");
    expect(moment.nextOpen?.date).toBe("2026-11-25");
  });

  it("walks a session from before the open to after the close", () => {
    const open = instantAt("2026-11-27", "09:30", "America/New_York");
    const close = instantAt("2026-11-27", "13:00", "America/New_York");
    const minuteBefore = (instant: string) =>
      new Date(Date.parse(instant) - 60_000).toISOString();

    expect(marketMomentAt(minuteBefore(open))).toMatchObject({
      phase: "before_open",
      nextOpen: { date: "2026-11-27" },
    });
    expect(marketMomentAt(open).phase).toBe("open");
    expect(marketMomentAt(minuteBefore(close)).phase).toBe("open");
    expect(marketMomentAt(close)).toMatchObject({
      phase: "after_close",
      nextOpen: { date: "2026-11-30" },
    });
  });

  it("says undeclared outside the table", () => {
    expect(marketMomentAt("2029-03-01T15:00:00.000Z").phase).toBe("undeclared");
  });
});

describe("clock shifts", () => {
  it("measures one or two hours between Buenos Aires and New York", () => {
    expect(hoursAheadOfNewYork("2026-11-26")).toBe(2);
    expect(hoursAheadOfNewYork("2026-07-15")).toBe(1);
  });

  it("finds the March and November Sundays when the open moves", () => {
    expect(nextClockShift("2026-11-26", 120)).toEqual({
      date: "2027-03-14",
      hoursAhead: 1,
      openBuenosAires: "10:30",
    });
    expect(nextClockShift("2027-03-14", 250)).toEqual({
      date: "2027-11-07",
      hoursAhead: 2,
      openBuenosAires: "11:30",
    });
    expect(nextClockShift("2026-03-01", 10)?.date).toBe("2026-03-08");
    expect(nextClockShift("2026-10-25", 10)?.date).toBe("2026-11-01");
  });

  it("returns null when no shift falls inside the window", () => {
    expect(nextClockShift("2026-11-26", 14)).toBeNull();
  });
});

describe("calendarCoverage", () => {
  it("asks for the next announcement within a year of the end", () => {
    expect(calendarCoverage("2026-11-26")).toEqual({
      coversTo: "2028-12-31",
      daysLeft: 766,
      renewalDue: false,
    });
    expect(calendarCoverage("2028-01-15").renewalDue).toBe(true);
  });
});
