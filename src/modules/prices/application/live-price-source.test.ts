import { describe, expect, it } from "vitest";

import { findEgressAllowlistEntry } from "@/server/egress/egress-allowlist";

import { buildChartUrl } from "./live-price-source";

describe("buildChartUrl", () => {
  it("asks for five calendar years plus two weeks, up to now", () => {
    const url = new URL(
      buildChartUrl("NVDA", new Date("2026-09-30T20:00:00.000Z")),
    );

    // 2026-09-30 − 5 años = 2021-09-30, − 14 días = 2021-09-16. La ventana de
    // 5 años al último cierre necesita un cierre en o antes del 2021-09-30.
    expect(url.searchParams.get("period1")).toBe(
      String(Date.parse("2021-09-16T00:00:00.000Z") / 1000),
    );
    expect(url.searchParams.get("period2")).toBe(
      String(Date.parse("2026-09-30T20:00:00.000Z") / 1000),
    );
    expect(url.searchParams.get("range")).toBeNull();
    expect(url.searchParams.get("events")).toBe("div,split");
  });

  it("stays inside the allowlisted chart prefix", () => {
    const url = new URL(
      buildChartUrl("BRK.B", new Date("2026-09-30T20:00:00.000Z")),
    );
    const entry = findEgressAllowlistEntry("yahoo-finance");

    expect(entry?.origins[0]?.host).toBe(url.host);
    expect(url.pathname).toBe("/v8/finance/chart/BRK.B");
    expect(
      entry?.origins[0]?.pathPrefixes.some((prefix) =>
        url.pathname.startsWith(prefix),
      ),
    ).toBe(true);
  });
});
