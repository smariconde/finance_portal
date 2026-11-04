import { describe, expect, it } from "vitest";

import {
  freshSince,
  lastDailySettledAt,
  selectStaleSubjects,
  startOfBuenosAiresDay,
  startOfBuenosAiresWeek,
} from "./refresh-freshness";

describe("lastDailySettledAt", () => {
  it("takes today's 23:00 UTC once it passed", () => {
    expect(lastDailySettledAt("2026-11-03T23:30:00.000Z")).toBe(
      "2026-11-03T23:00:00.000Z",
    );
  });

  it("takes the previous weekday before today's settles", () => {
    expect(lastDailySettledAt("2026-11-03T12:00:00.000Z")).toBe(
      "2026-11-02T23:00:00.000Z",
    );
  });

  it("skips the weekend back to Friday", () => {
    // Monday 2026-11-02 before the settle, and Sunday 2026-11-01.
    expect(lastDailySettledAt("2026-11-02T10:00:00.000Z")).toBe(
      "2026-10-30T23:00:00.000Z",
    );
    expect(lastDailySettledAt("2026-11-01T23:59:00.000Z")).toBe(
      "2026-10-30T23:00:00.000Z",
    );
  });
});

describe("startOfBuenosAiresDay", () => {
  it("is 03:00 UTC of the local date, also right after UTC midnight", () => {
    expect(startOfBuenosAiresDay("2026-11-03T15:00:00.000Z")).toBe(
      "2026-11-03T03:00:00.000Z",
    );
    // 01:00 UTC on the 4th is still the 3rd in Buenos Aires.
    expect(startOfBuenosAiresDay("2026-11-04T01:00:00.000Z")).toBe(
      "2026-11-03T03:00:00.000Z",
    );
  });
});

describe("startOfBuenosAiresWeek", () => {
  it("holds the monthly sources through the local week and turns on Monday", () => {
    expect(startOfBuenosAiresWeek("2026-11-08T23:00:00.000Z")).toBe(
      "2026-11-02T03:00:00.000Z",
    );
    expect(startOfBuenosAiresWeek("2026-11-09T02:59:00.000Z")).toBe(
      "2026-11-02T03:00:00.000Z",
    );
    expect(startOfBuenosAiresWeek("2026-11-09T03:00:00.000Z")).toBe(
      "2026-11-09T03:00:00.000Z",
    );
  });
});

describe("selectStaleSubjects", () => {
  const now = "2026-11-03T15:00:00.000Z";

  it("keeps daily subjects since the last settle and monthly subjects since Monday", () => {
    const lastChecks = new Map([
      ["fresh", "2026-11-02T23:10:00.000Z"],
      ["before-settle", "2026-11-02T22:59:00.000Z"],
    ]);
    expect(
      selectStaleSubjects({
        subjects: ["fresh", "before-settle", "never"],
        lastChecks,
        cadence: "daily",
        now,
      }),
    ).toEqual(["before-settle", "never"]);
    expect(
      selectStaleSubjects({
        subjects: ["fresh", "today"],
        lastChecks: new Map([
          ["fresh", "2026-11-02T23:10:00.000Z"],
          ["today", "2026-11-03T03:00:00.000Z"],
        ]),
        cadence: "monthly",
        now,
      }),
    ).toEqual([]);
  });

  it("names the threshold of each cadence", () => {
    expect(freshSince("daily", now)).toBe("2026-11-02T23:00:00.000Z");
    expect(freshSince("monthly", now)).toBe("2026-11-02T03:00:00.000Z");
  });
});
