import { describe, expect, it } from "vitest";

import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import { declaredArgentinaIndicator } from "@/modules/macro-series/domain/declared-argentina-indicators";

import {
  buildActivityBlock,
  buildDollarBlock,
  buildExternalBlock,
  buildMonetaryBlock,
  type IndicatorSeries,
} from "./argentina-dashboard";
import { buildCountryRiskBlock } from "./country-risk-block";
import type { SoyBlock } from "./soy-block";
import {
  SUMMARY_CHANGE_VERSION,
  SUMMARY_POLARITY,
  summaryChange,
  summaryChanges,
} from "./summary-change";

function vintage(
  indicatorId: string,
  periodOn: string,
  value: string,
): ArgentinaIndicatorVintage {
  return {
    indicatorId,
    periodOn,
    value,
    missingReason: null,
    sourceNote: null,
    availableAt: "2026-11-17T12:00:00.000Z",
    recordedAt: "2026-11-17T12:00:01.000Z",
    revision: 0,
    segment: "embi-ar",
    sourceRunId: "run",
  };
}

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

const EMPTY_SOY: SoyBlock = {
  days: [],
  months: [],
  latest: null,
  legs: { rosario: null, fx: null, chicago: null },
  campaigns: [],
  productionChange: null,
};

describe(SUMMARY_CHANGE_VERSION, () => {
  it("subtracts the previous month in percentage points", () => {
    expect(
      summaryChange({
        current: { on: "2026-09-01", value: "2.1" },
        previous: { on: "2026-08-01", value: "1.9" },
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({
      status: "computed",
      currentOn: "2026-09-01",
      previousOn: "2026-08-01",
      difference: "0.2",
      unit: "pp",
      version: SUMMARY_CHANGE_VERSION,
    });
  });

  it("reads a fraction's change in points without floating point", () => {
    const change = summaryChange({
      current: { on: "2026-11-13", value: "0.071" },
      previous: { on: "2026-11-12", value: "0.0523" },
      cadence: "daily",
      basis: "fraction",
    });
    expect(change).toMatchObject({ difference: "1.87", unit: "pp" });
  });

  it("keeps an amount in its own unit and crosses zero with its sign", () => {
    expect(
      summaryChange({
        current: { on: "2026-08-01", value: "-150" },
        previous: { on: "2026-07-01", value: "2187" },
        cadence: "monthly",
        basis: "amount",
      }),
    ).toMatchObject({ difference: "-2337", unit: "amount" });
    expect(
      summaryChange({
        current: { on: "2026-08-01", value: "300" },
        previous: { on: "2026-07-01", value: "-200" },
        cadence: "monthly",
        basis: "amount",
      }),
    ).toMatchObject({ difference: "500" });
  });

  it("writes an unchanged reading as zero, never as a signed zero", () => {
    expect(
      summaryChange({
        current: { on: "2025-01-01", value: "-0.5" },
        previous: { on: "2024-01-01", value: "-0.50" },
        cadence: "annual",
        basis: "percent",
      }),
    ).toMatchObject({ status: "computed", difference: "0" });
  });

  it("reads two negatives: less negative is a positive change", () => {
    expect(
      summaryChange({
        current: { on: "2026-11-13", value: "-28.4" },
        previous: { on: "2026-11-12", value: "-30.1" },
        cadence: "daily",
        basis: "percent",
      }),
    ).toMatchObject({ difference: "1.7" });
  });

  it("names a missing reading instead of comparing against zero", () => {
    expect(
      summaryChange({
        current: { on: "2026-09-01", value: null },
        previous: { on: "2026-08-01", value: "1.9" },
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "missing_current" });
    expect(
      summaryChange({
        current: null,
        previous: null,
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "missing_current" });
    expect(
      summaryChange({
        current: { on: "2026-09-01", value: "2.1" },
        previous: { on: "2026-08-01", value: null },
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "missing_previous" });
    expect(
      summaryChange({
        current: { on: "2026-09-01", value: "2.1" },
        previous: null,
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "missing_previous" });
  });

  it("never jumps over a gap to an older reading", () => {
    expect(
      summaryChange({
        current: { on: "2026-09-01", value: "2.1" },
        previous: { on: "2026-07-01", value: "1.9" },
        cadence: "monthly",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "previous_not_adjacent" });
    expect(
      summaryChange({
        current: { on: "2025-01-01", value: "1.4" },
        previous: { on: "2023-01-01", value: "-0.3" },
        cadence: "annual",
        basis: "percent",
      }),
    ).toEqual({ status: "unavailable", reason: "previous_not_adjacent" });
    expect(
      summaryChange({
        current: { on: "2026-11-13", value: "0.07" },
        previous: { on: "2026-11-13", value: "0.06" },
        cadence: "daily",
        basis: "fraction",
      }),
    ).toEqual({ status: "unavailable", reason: "previous_not_adjacent" });
  });

  it("compares a January with the December before", () => {
    expect(
      summaryChange({
        current: { on: "2026-01-01", value: "2.2" },
        previous: { on: "2025-12-01", value: "2.8" },
        cadence: "monthly",
        basis: "percent",
      }),
    ).toMatchObject({ status: "computed", difference: "-0.6" });
  });

  it("declares a polarity for every tile", () => {
    expect(SUMMARY_POLARITY).toEqual({
      activity: "higher_is_better",
      fxGap: "lower_is_better",
      inflation: "lower_is_better",
      countryRisk: "lower_is_better",
      tradeBalance: "higher_is_better",
      soyGap: "higher_is_better",
    });
  });
});

describe("summaryChanges", () => {
  const sa = series(
    "emae_sa",
    months("2026-05-01", 4, (i) => ["100", "102", "101", "102.01"][i]!),
  );
  const activity = buildActivityBlock({
    seasonallyAdjusted: sa,
    trend: series("emae_trend", []),
    original: series("emae_original", []),
    sectors: [],
  });
  const dollar = buildDollarBlock({
    official: [
      { periodOn: "2026-11-10", value: "1000" },
      { periodOn: "2026-11-11", value: "1000" },
      { periodOn: "2026-11-12", value: "1000" },
    ],
    ccl: [
      { marketDate: "2026-11-10", value: "1100" },
      { marketDate: "2026-11-11", value: null },
      { marketDate: "2026-11-12", value: "1050" },
    ],
    bandLow: [],
    bandHigh: [],
  });
  const monetary = buildMonetaryBlock({
    monthlyInflation: [
      { periodOn: "2026-08-01", value: "1.9" },
      { periodOn: "2026-09-01", value: "2.1" },
    ],
    annualInflation: [],
    reserves: [],
    realBase: [],
    realBaseUnit: null,
    realBaseOn: null,
  });
  const countryRisk = buildCountryRiskBlock({
    points: [
      vintage("ar_country_risk_embi", "2026-11-13", "830"),
      vintage("ar_country_risk_embi", "2026-11-16", "855.5"),
    ],
    dailyFromOn: "2021-11-16",
  });
  const external = buildExternalBlock({
    exports: series(
      "exports_goods",
      months("2026-07-01", 2, (i) => ["7000", "6800"][i]!),
    ),
    imports: series(
      "imports_goods",
      months("2026-07-01", 2, (i) => ["6000", "6900"][i]!),
    ),
  });

  it("reads each tile against its previous reading, and names the ones it cannot", () => {
    const changes = summaryChanges({
      activity,
      dollar,
      monetary,
      countryRisk,
      external,
      soy: EMPTY_SOY,
    });
    // August: 102.01 / 101 − 1 = 1 %; July: 101 / 102 − 1 ≈ −0.98 %.
    expect(changes.activity).toMatchObject({
      status: "computed",
      currentOn: "2026-08-01",
      previousOn: "2026-07-01",
      unit: "pp",
    });
    expect(
      changes.activity.status === "computed" &&
        changes.activity.difference.startsWith("1.98"),
    ).toBe(true);
    // The 11th had no CCL: the 12th compares with the 10th.
    expect(changes.fxGap).toMatchObject({
      status: "computed",
      currentOn: "2026-11-12",
      previousOn: "2026-11-10",
      difference: "-5",
    });
    expect(changes.inflation).toMatchObject({ difference: "0.2" });
    expect(changes.tradeBalance).toMatchObject({
      difference: "-1100",
      unit: "amount",
    });
    // A spread changes in basis points, against the previous close.
    expect(changes.countryRisk).toMatchObject({
      status: "computed",
      currentOn: "2026-11-16",
      previousOn: "2026-11-13",
      difference: "25.5",
      unit: "bp",
      version: "summary-change-1.1.0",
    });
    expect(changes.soyGap).toEqual({
      status: "unavailable",
      reason: "missing_current",
    });
  });

  it("names a missing BCRA month instead of reading an older one", () => {
    const withGap = buildMonetaryBlock({
      monthlyInflation: [
        { periodOn: "2026-07-01", value: "1.9" },
        { periodOn: "2026-09-01", value: "2.1" },
      ],
      annualInflation: [],
      reserves: [],
      realBase: [],
      realBaseUnit: null,
      realBaseOn: null,
    });
    expect(
      summaryChanges({
        activity,
        dollar,
        monetary: withGap,
        countryRisk,
        external,
        soy: EMPTY_SOY,
      }).inflation,
    ).toEqual({ status: "unavailable", reason: "previous_not_adjacent" });
  });

  it("reads a database without BCRA series as missing, never as zero", () => {
    const changes = summaryChanges({
      activity,
      dollar: buildDollarBlock({
        official: [],
        ccl: [],
        bandLow: [],
        bandHigh: [],
      }),
      monetary: buildMonetaryBlock({
        monthlyInflation: [],
        annualInflation: [],
        reserves: [],
        realBase: [],
        realBaseUnit: null,
        realBaseOn: null,
      }),
      countryRisk,
      external,
      soy: EMPTY_SOY,
    });
    expect(changes.fxGap).toEqual({
      status: "unavailable",
      reason: "missing_current",
    });
    expect(changes.inflation).toEqual({
      status: "unavailable",
      reason: "missing_current",
    });
  });
});
