import { describe, expect, it } from "vitest";

import {
  declaredMonths,
  marketMonth,
  upcomingMarketEvents,
} from "./market-month";

describe("marketMonth", () => {
  it("lays November 2026 out Monday to Friday, padding into December", () => {
    const month = marketMonth("2026-11");
    expect(month.weeks).toHaveLength(5);
    // Noviembre de 2026 empieza en domingo: no abre con una semana de octubre.
    expect(month.weeks[0]!.map((day) => [day.date, day.inMonth])).toEqual([
      ["2026-11-02", true],
      ["2026-11-03", true],
      ["2026-11-04", true],
      ["2026-11-05", true],
      ["2026-11-06", true],
    ]);
    expect(month.weeks.at(-1)!.map((day) => day.date)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
    const thanksgiving = month.weeks
      .flat()
      .find((day) => day.date === "2026-11-26");
    expect(thanksgiving).toMatchObject({ status: "holiday", inMonth: true });
  });

  it("starts with the partial week when the 1st is a weekday", () => {
    const month = marketMonth("2026-12");
    expect(month.weeks[0]!.map((day) => day.inMonth)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it("rejects what is not a month", () => {
    expect(() => marketMonth("2026-13")).toThrow(TypeError);
  });
});

describe("declaredMonths", () => {
  it("spans the 36 declared months", () => {
    const months = declaredMonths();
    expect(months).toHaveLength(36);
    expect([months[0], months.at(-1)]).toEqual(["2026-01", "2028-12"]);
  });
});

describe("upcomingMarketEvents", () => {
  it("lists Thanksgiving, its early close and Christmas from the 26th", () => {
    expect(
      upcomingMarketEvents("2026-11-26", 30).map((event) => [
        event.kind,
        event.date,
        event.daysAway,
      ]),
    ).toEqual([
      ["holiday", "2026-11-26", 0],
      ["early_close", "2026-11-27", 1],
      ["early_close", "2026-12-24", 28],
      ["holiday", "2026-12-25", 29],
    ]);
  });

  it("places the March clock shift among the holidays", () => {
    const events = upcomingMarketEvents("2027-02-20", 40);
    expect(events.map((event) => [event.kind, event.date])).toEqual([
      ["clock_shift", "2027-03-14"],
      ["holiday", "2027-03-26"],
    ]);
    const shift = events[0]!;
    expect(shift.kind === "clock_shift" && shift.shift.openBuenosAires).toBe(
      "10:30",
    );
  });

  it("stops at the end of the declaration", () => {
    expect(upcomingMarketEvents("2028-12-20", 60).map((e) => e.date)).toEqual([
      "2028-12-25",
    ]);
  });
});
