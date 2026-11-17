import { describe, expect, it } from "vitest";

import {
  argentinaNews,
  latestJointReading,
  latestReading,
  newsStatus,
  NEWS_METRICS,
  type NewsMetric,
  type NewsReading,
} from "./argentina-news";

function readings(
  value: NewsReading | null,
): Record<NewsMetric, NewsReading | null> {
  return Object.fromEntries(
    NEWS_METRICS.map((metric) => [metric, value]),
  ) as Record<NewsMetric, NewsReading | null>;
}

describe("argentina-news-1.0.0", () => {
  it("marks a later period as new", () => {
    expect(
      newsStatus({
        current: { on: "2026-10-31", values: ["2.2"] },
        baseline: { on: "2026-09-30", values: ["1.9"] },
      }),
    ).toEqual({ status: "new_period", on: "2026-10-31" });
  });

  it("marks a first period where there was none as new", () => {
    expect(
      newsStatus({
        current: { on: "2026-11", values: ["2.1", "1.9"] },
        baseline: null,
      }),
    ).toEqual({ status: "new_period", on: "2026-11" });
  });

  it("marks the same period with another value as revised", () => {
    expect(
      newsStatus({
        current: { on: "2026-08-01", values: ["151.512"] },
        baseline: { on: "2026-08-01", values: ["151.554"] },
      }),
    ).toEqual({ status: "revised", on: "2026-08-01" });
  });

  it("compares values as decimals, never as text", () => {
    expect(
      newsStatus({
        current: { on: "2026-09-30", values: ["1.90"] },
        baseline: { on: "2026-09-30", values: ["1.9"] },
      }),
    ).toEqual({ status: "unchanged" });
  });

  it("does not mark a period that went back nor a series that is empty now", () => {
    expect(
      newsStatus({
        current: { on: "2026-08-01", values: ["1"] },
        baseline: { on: "2026-09-01", values: ["1"] },
      }),
    ).toEqual({ status: "unchanged" });
    expect(
      newsStatus({
        current: null,
        baseline: { on: "2026-09-01", values: ["1"] },
      }),
    ).toEqual({ status: "unchanged" });
  });

  it("marks nothing without a baseline", () => {
    expect(
      argentinaNews({
        since: null,
        current: readings({ on: "2026-10-31", values: ["2.2"] }),
        baseline: readings(null),
      }),
    ).toEqual({ status: "no_baseline" });
  });

  it("compares every declared metric against the baseline", () => {
    const news = argentinaNews({
      since: "2026-11-10T12:00:00.000Z",
      current: {
        ...readings({ on: "2026-08-01", values: ["1"] }),
        inflation: { on: "2026-10-31", values: ["2.2"] },
      },
      baseline: {
        ...readings({ on: "2026-08-01", values: ["1"] }),
        inflation: { on: "2026-09-30", values: ["1.9"] },
      },
    });
    expect(news).toEqual({
      status: "compared",
      version: "argentina-news-1.0.0",
      since: "2026-11-10T12:00:00.000Z",
      metrics: {
        activity: { status: "unchanged" },
        inflation: { status: "new_period", on: "2026-10-31" },
        remRound: { status: "unchanged" },
        primaryBalance: { status: "unchanged" },
        tradeBalance: { status: "unchanged" },
      },
    });
  });

  it("reads the latest period with a value whatever the order", () => {
    expect(
      latestReading([
        { on: "2026-09-01", value: "3" },
        { on: "2026-10-01", value: null },
        { on: "2026-08-01", value: "2" },
      ]),
    ).toEqual({ on: "2026-09-01", values: ["3"] });
    expect(latestReading([{ on: "2026-09-01", value: null }])).toBeNull();
  });

  it("reads a trade month only when both legs published it", () => {
    expect(
      latestJointReading(
        [
          { on: "2026-08-01", value: "7000" },
          { on: "2026-09-01", value: "7500" },
        ],
        [
          { on: "2026-08-01", value: "5000" },
          { on: "2026-09-01", value: null },
        ],
      ),
    ).toEqual({ on: "2026-08-01", values: ["7000", "5000"] });
    expect(
      latestJointReading([], [{ on: "2026-08-01", value: "1" }]),
    ).toBeNull();
  });
});
