import { describe, expect, it } from "vitest";

import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import { declaredArgentinaIndicator } from "@/modules/macro-series/domain/declared-argentina-indicators";

import {
  buildActivityBlock,
  buildDollarBlock,
  buildExternalBlock,
  buildFiscalBlock,
  type IndicatorSeries,
} from "./argentina-dashboard";

function series(
  id: string,
  values: readonly (readonly [string, string | null])[],
): IndicatorSeries {
  const indicator = declaredArgentinaIndicator(id)!;
  return {
    indicator,
    points: values.map(([periodOn, value]): ArgentinaIndicatorVintage => ({
      indicatorId: id,
      periodOn,
      value,
      missingReason: value === null ? "source_null" : null,
      sourceNote: null,
      availableAt: "2026-11-03T12:00:00.000Z",
      recordedAt: "2026-11-03T12:00:01.000Z",
      revision: 0,
      segment: indicator.segment,
      sourceRunId: "run",
    })),
  };
}

function months(
  from: string,
  count: number,
  value: (index: number) => string | null,
) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + index);
    return [date.toISOString().slice(0, 10), value(index)] as const;
  });
}

describe("buildActivityBlock", () => {
  it("reads the latest month against the previous one and a year earlier", () => {
    const sa = series(
      "emae_sa",
      months("2025-01-01", 20, (i) => String(100 + i)),
    );
    const original = series(
      "emae_original",
      months("2025-01-01", 20, (i) =>
        i === 7 ? "100" : i === 19 ? "110" : "105",
      ),
    );
    const block = buildActivityBlock({
      seasonallyAdjusted: sa,
      trend: series("emae_trend", []),
      original,
      sectors: [],
    });
    expect(block.latest?.on).toBe("2026-08-01");
    expect(block.latest?.monthOverMonth).toMatchObject({ status: "computed" });
    expect(block.latest?.yearOverYear).toMatchObject({
      status: "computed",
      value: "10",
    });
    expect(block.sectorMonths).toEqual([]);
  });

  it("names a sector month without its year-earlier point instead of zeroing it", () => {
    const sector = series(
      "emae_sector_f",
      months("2025-06-01", 15, (i) => (i === 0 ? null : "120")),
    );
    const block = buildActivityBlock({
      seasonallyAdjusted: series("emae_sa", []),
      trend: series("emae_trend", []),
      original: series("emae_original", []),
      sectors: [sector],
    });
    expect(block.latest).toBeNull();
    expect(block.sectorMonths).toHaveLength(12);
    expect(block.sectorMonths.at(-1)).toBe("2026-08-01");
    const cells = block.sectors[0]!.cells;
    // June 2026 compares with June 2025, which is null.
    expect(cells.find((cell) => cell.on === "2026-06-01")?.change).toEqual({
      status: "unavailable",
      reason: "missing_value",
    });
    // September 2025 has no point a year earlier at all.
    expect(cells[0]?.change).toEqual({
      status: "unavailable",
      reason: "incompatible_period",
    });
    expect(block.sectors[0]).toMatchObject({
      code: "F",
      label: "Construcción",
    });
  });
});

describe("buildDollarBlock", () => {
  it("measures the gap only on days both quotes published", () => {
    const block = buildDollarBlock({
      official: [
        { periodOn: "2026-10-30", value: "1000" },
        { periodOn: "2026-11-02", value: "1010" },
      ],
      ccl: [
        { marketDate: "2026-10-30", value: "1100" },
        { marketDate: "2026-10-31", value: "1105" },
        { marketDate: "2026-11-02", value: null },
      ],
      bandLow: [{ periodOn: "2026-11-02", value: "900" }],
      bandHigh: [{ periodOn: "2026-11-02", value: "1500" }],
    });
    expect(block.days.map((day) => [day.on, day.gap])).toEqual([
      ["2026-10-30", "0.1"],
      ["2026-10-31", null],
      ["2026-11-02", null],
    ]);
    expect(block.latestGap).toEqual({ on: "2026-10-30", gap: "0.1" });
    expect(block.latestCcl).toEqual({ on: "2026-10-31", value: "1105" });
    expect(block.latestBand).toEqual({
      on: "2026-11-02",
      low: "900",
      high: "1500",
    });
  });

  it("returns an empty block without quotes", () => {
    expect(
      buildDollarBlock({ official: [], ccl: [], bandLow: [], bandHigh: [] }),
    ).toMatchObject({ days: [], latestGap: null, latestOfficial: null });
  });
});

describe("buildFiscalBlock", () => {
  it("shows complete years over GDP and the running year in pesos only", () => {
    const primary = series(
      "fiscal_primary_result",
      months("2024-01-01", 20, () => "10"),
    );
    const interest = series(
      "fiscal_net_interest",
      months("2024-01-01", 20, () => "5"),
    );
    const gdp = series("gdp_nominal_annual", [["2024-01-01", "1200"]]);
    const block = buildFiscalBlock({ primary, interest, gdp });
    expect(block.years).toEqual([
      {
        year: 2024,
        primary: expect.objectContaining({ status: "computed", value: "10" }),
        interest: expect.objectContaining({ status: "computed", value: "5" }),
      },
    ]);
    expect(block.yearToDate).toEqual({
      year: 2025,
      months: 8,
      lastOn: "2025-08-01",
      primary: "80",
    });
  });

  it("keeps a complete year without GDP as a named gap", () => {
    const block = buildFiscalBlock({
      primary: series(
        "fiscal_primary_result",
        months("2024-01-01", 12, () => "1"),
      ),
      interest: series(
        "fiscal_net_interest",
        months("2024-01-01", 12, () => "1"),
      ),
      gdp: series("gdp_nominal_annual", []),
    });
    expect(block.years[0]?.primary).toEqual({
      status: "unavailable",
      reason: "incompatible_period",
    });
    expect(block.yearToDate).toBeNull();
  });
});

describe("buildExternalBlock", () => {
  it("sums twelve months only when all twelve are there", () => {
    const exports = series(
      "exports_goods",
      months("2025-01-01", 14, () => "10"),
    );
    const imports = series(
      "imports_goods",
      months("2025-01-01", 14, () => "7"),
    );
    const block = buildExternalBlock({ exports, imports });
    expect(block.lastTwelve).toEqual({
      fromOn: "2025-03-01",
      toOn: "2026-02-01",
      exports: "120",
      imports: "84",
      balance: "36",
    });
    expect(block.months.at(-1)?.balance).toMatchObject({ value: "3" });

    const gap = buildExternalBlock({
      exports,
      imports: series(
        "imports_goods",
        months("2025-01-01", 13, () => "7"),
      ),
    });
    expect(gap.lastTwelve).toBeNull();
    expect(gap.months.at(-1)?.balance).toEqual({
      status: "unavailable",
      reason: "incompatible_period",
    });
  });
});
