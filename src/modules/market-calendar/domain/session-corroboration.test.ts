import { describe, expect, it } from "vitest";

import { marketDayOf } from "./market-sessions";
import {
  corroborateSession,
  type BrokerMarketDay,
} from "./session-corroboration";

const earlyClose: BrokerMarketDay = {
  date: "2026-11-27",
  preMarket: {
    start: "2026-11-27T12:00:00.000Z",
    end: "2026-11-27T14:30:00.000Z",
  },
  regularMarket: {
    start: "2026-11-27T14:30:00.000Z",
    end: "2026-11-27T18:00:00.000Z",
  },
  postMarket: {
    start: "2026-11-27T18:00:00.000Z",
    end: "2026-11-27T22:00:00.000Z",
  },
};

describe("corroborateSession", () => {
  it("matches the declared early close and reads extended hours in Buenos Aires", () => {
    expect(corroborateSession(marketDayOf("2026-11-27"), earlyClose)).toEqual({
      date: "2026-11-27",
      matches: true,
      differences: [],
      broker: {
        regular: { open: "11:30", close: "15:00" },
        extended: { open: "09:00", close: "19:00" },
      },
    });
  });

  it("matches a holiday the broker also reports closed", () => {
    expect(
      corroborateSession(marketDayOf("2026-11-26"), {
        date: "2026-11-26",
        preMarket: null,
        regularMarket: null,
        postMarket: null,
      }),
    ).toMatchObject({
      matches: true,
      broker: { regular: null, extended: null },
    });
  });

  it("names a close the broker moved and a day it closed", () => {
    const fullDay = {
      ...earlyClose,
      regularMarket: {
        start: earlyClose.regularMarket!.start,
        end: "2026-11-27T21:00:00.000Z",
      },
    };
    expect(
      corroborateSession(marketDayOf("2026-11-27"), fullDay).differences,
    ).toEqual(["regular_close"]);

    expect(
      corroborateSession(marketDayOf("2026-12-01"), {
        date: "2026-12-01",
        preMarket: null,
        regularMarket: null,
        postMarket: null,
      }),
    ).toMatchObject({ matches: false, differences: ["open_status"] });
  });

  it("only has the broker outside the declaration", () => {
    expect(
      corroborateSession(marketDayOf("2029-01-02"), {
        date: "2029-01-02",
        preMarket: null,
        regularMarket: {
          start: "2029-01-02T14:30:00.000Z",
          end: "2029-01-02T21:00:00.000Z",
        },
        postMarket: null,
      }),
    ).toMatchObject({
      matches: false,
      differences: ["undeclared"],
      broker: { regular: { open: "11:30", close: "18:00" }, extended: null },
    });
  });

  it("refuses to compare two dates", () => {
    expect(() =>
      corroborateSession(marketDayOf("2026-11-30"), earlyClose),
    ).toThrow(RangeError);
  });
});
