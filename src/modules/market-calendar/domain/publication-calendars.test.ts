import { describe, expect, it } from "vitest";

import { parseBcraReportCalendar } from "./bcra-report-calendar";
import type {
  CalendarRevision,
  EconomicPublication,
} from "./calendar-publication";
import {
  type EarningsReport,
  parseEarningsCalendar,
} from "./earnings-calendar";
import { earningsExposureAt, reportsToday } from "./earnings-exposure";
import { expectedArgentinePublications } from "./expected-argentina-publications";
import {
  fredCalendarPageUrl,
  parseFredCalendarPage,
  reconcileFredDates,
} from "./fred-release-calendar";

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

const fredDate = (date: string) => ({
  release_id: 10,
  release_name: "Consumer Price Index",
  date,
});
const oldDate = (date: string): CalendarRevision => ({
  key: `fred:10:${date}`,
  observedAt: "2026-11-26T14:00:00Z",
  previous: null,
  event: {
    kind: "economic",
    publication: {
      id: "10",
      date,
      title: "IPC",
      status: "scheduled",
      period: null,
    },
  },
});

describe("FRED release dates", () => {
  it("requests unpublished releases, omits credentials and refuses truncated pages", () => {
    const day = "2026-11-26";
    const url = new URL(fredCalendarPageUrl(day, 0));
    expect(url.searchParams.get("include_release_dates_with_no_data")).toBe(
      "true",
    );
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(url.searchParams.get("realtime_start")).toBe("2026-11-19");
    expect(url.searchParams.get("realtime_end")).toBe("2027-03-04");
    const page = {
      realtime_start: "2026-11-19",
      realtime_end: "2027-03-04",
      order_by: "release_date",
      sort_order: "desc",
      offset: 0,
      limit: 1000,
      count: 1,
      release_dates: [fredDate("2026-12-10")],
    };
    expect(parseFredCalendarPage(JSON.stringify(page), day, 0).last).toBe(true);
    expect(() =>
      parseFredCalendarPage(JSON.stringify({ ...page, count: 2 }), day, 0),
    ).toThrow();
  });

  it("keeps the chain when a date moves and marks withdrawals inside confirmed coverage", () => {
    const rows = [fredDate("2026-12-11"), fredDate("2027-02-10")];
    const result = reconcileFredDates(
      rows,
      [oldDate("2026-12-10"), oldDate("2027-01-12"), oldDate("2027-03-09")],
      "2026-11-26",
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "fred:10:2026-12-10",
          publication: expect.objectContaining({
            date: "2026-12-11",
            status: "scheduled",
          }),
        }),
        expect.objectContaining({
          key: "fred:10:2027-01-12",
          publication: expect.objectContaining({ status: "cancelled" }),
        }),
      ]),
    );
    expect(
      result.find(({ key }) => key === "fred:10:2027-03-09"),
    ).toBeUndefined();
  });
});

describe("Argentine release dates", () => {
  it("accepts the identified BCRA table only, with a previous-year REM period in January", () => {
    const html =
      "<h1>Calendario de informes 2027</h1><table><tr><th>Publicaciones</th><th>Fecha</th></tr><tr><td>Relevamiento de Expectativas de Mercado (REM)</td><td>07 ene 2027</td></tr></table>";
    expect(parseBcraReportCalendar(html)).toMatchObject([
      { publication: { id: "rem", date: "2027-01-07", period: "2026-12-01" } },
    ]);
    expect(() =>
      parseBcraReportCalendar(
        html.replace("Calendario de informes", "Comunicados"),
      ),
    ).toThrow("bcra_calendar_title_changed");
    expect(() =>
      parseBcraReportCalendar(html.replace("Publicaciones", "Cuadros")),
    ).toThrow("bcra_calendar_table_changed");
  });

  it("keeps a missing scheduled period visible until it arrives", () => {
    const publication = {
      id: "ipc",
      title: "IPC nacional",
      date: "2026-12-15",
      period: "2026-11-01",
      status: "scheduled",
      time: "16:00",
    } satisfies EconomicPublication & { time: string };
    const previous = {
      ...publication,
      date: "2026-11-12",
      period: "2026-10-01",
    };
    const releases = [publication, previous];
    expect(
      expectedArgentinePublications(releases, "2026-12-15T18:59:00.000Z", {
        monetary: "2026-10-31",
      }),
    ).toEqual({
      monetary: { title: "IPC nacional", state: "today", period: "2026-11-01" },
    });
    expect(
      expectedArgentinePublications(releases, "2026-12-15T19:01:00.000Z", {}),
    ).toEqual({
      monetary: {
        title: "IPC nacional",
        state: "pending",
        period: "2026-11-01",
      },
    });
    expect(
      expectedArgentinePublications(releases, "2026-12-16T15:00:00.000Z", {}),
    ).toEqual({
      monetary: {
        title: "IPC nacional",
        state: "pending",
        period: "2026-11-01",
      },
    });
    expect(
      expectedArgentinePublications(releases, "2026-12-16T15:00:00.000Z", {
        monetary: "2026-11-30",
      }),
    ).toEqual({});
    expect(
      expectedArgentinePublications(
        [publication],
        "2026-12-15T02:59:00.000Z",
        {},
      ),
    ).toEqual({});
    expect(
      expectedArgentinePublications(
        [{ ...publication, status: "cancelled" }],
        "2026-12-16T15:00:00.000Z",
        {},
      ),
    ).toEqual({});
  });
});
