import { describe, expect, it } from "vitest";

import {
  type EarningsReport,
  parseEarningsCalendar,
} from "./earnings-calendar";
import { earningsExposureAt, reportsToday } from "./earnings-exposure";

const HEADER =
  "symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay";
const report = (
  date: string,
  time: EarningsReport["time"] = null,
): EarningsReport => ({
  symbol: "XYZ",
  date,
  time,
  fiscalDateEnding: "2026-09-30",
  estimate: null,
  currency: "USD",
});

describe("earnings calendar", () => {
  it("reads quoted names and signed estimates from text, preserving blanks", () => {
    expect(
      parseEarningsCalendar(
        HEADER +
          '\r\nXYZ,"Issuer, Inc.",2026-11-27,2026-09-30,-002.2300,USD,post-market\r\nABC,Issuer,2026-11-30,,,USD,\r\n',
      ),
    ).toMatchObject([
      { symbol: "XYZ", estimate: "-2.23", time: "post-market" },
      { symbol: "ABC", fiscalDateEnding: null, estimate: null, time: null },
    ]);
  });

  it.each([
    ["an error object", '{"Information":"quota"}'],
    ["a new column", HEADER + ",offset"],
    ["an empty dataset", HEADER],
    ["an invalid date", HEADER + "\nXYZ,Name,2026-02-30,2026-01-31,0,USD,"],
    ["a non-finite EPS", HEADER + "\nXYZ,Name,2026-11-27,2026-09-30,NaN,USD,"],
    [
      "an unknown time",
      HEADER + "\nXYZ,Name,2026-11-27,2026-09-30,0,USD,midday",
    ],
  ])("refuses %s", (_case, text) =>
    expect(() => parseEarningsCalendar(text)).toThrow(),
  );

  it("counts five declared sessions across Thanksgiving, with unknown hours still exposed", () => {
    const at = "2026-11-25T16:00:00.000Z";
    expect(earningsExposureAt(report("2026-12-02"), at)?.session).toBe(5);
    expect(earningsExposureAt(report("2026-12-03"), at)).toBeNull();
    expect(
      earningsExposureAt(report("2026-11-25", "pre-market"), at),
    ).toBeNull();
  });

  it("shows day opportunities only for known hours and an operating market", () => {
    const at = "2026-11-27T16:00:00.000Z";
    expect(reportsToday(report("2026-11-26", "post-market"), at)).toBe(true);
    expect(reportsToday(report("2026-11-27", "pre-market"), at)).toBe(true);
    expect(reportsToday(report("2026-11-27"), at)).toBe(false);
    expect(
      reportsToday(report("2026-11-26", "pre-market"), "2026-11-26T16:00:00Z"),
    ).toBe(false);
  });
});
