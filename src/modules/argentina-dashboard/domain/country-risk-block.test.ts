import { describe, expect, it } from "vitest";

import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import { countryRiskIndexOn } from "@/modules/macro-series/domain/declared-country-risk";

import { buildCountryRiskBlock } from "./country-risk-block";

function point(
  periodOn: string,
  value: string | null,
  revision = 0,
): ArgentinaIndicatorVintage {
  return {
    indicatorId: "ar_country_risk_embi",
    periodOn,
    value,
    missingReason: value === null ? "source_null" : null,
    sourceNote: null,
    availableAt: "2026-11-17T12:00:00.000Z",
    recordedAt: "2026-11-17T12:00:00.000Z",
    revision,
    segment: "embi-ar",
    sourceRunId: "run",
  };
}

describe("country-risk-block-1.0.0", () => {
  it("reads the latest close with its index and the change against the one before", () => {
    const block = buildCountryRiskBlock({
      points: [point("2025-09-29", "1115"), point("2025-09-30", "1222", 1)],
      dailyFromOn: "2021-01-01",
    });
    expect(block.latest).toMatchObject({
      on: "2025-09-30",
      value: "1222",
      revision: 1,
      index: { id: "embi_global_diversified" },
    });
    expect(block.previous).toEqual({ on: "2025-09-29", value: "1115" });
    expect(block.changeBp).toBe("107");
  });

  it("skips a missing close to find the previous one, and keeps decimals exact", () => {
    const block = buildCountryRiskBlock({
      points: [
        point("2005-01-03", "4512.37"),
        point("2005-01-04", null),
        point("2005-01-05", "4601.1"),
      ],
      dailyFromOn: "2000-01-01",
    });
    expect(block.previous?.on).toBe("2005-01-03");
    expect(block.changeBp).toBe("88.73");
    expect(block.latest?.index?.id).toBe("embi_plus");
  });

  it("has no change with a single close and nothing without one", () => {
    expect(
      buildCountryRiskBlock({
        points: [point("2026-11-16", "855")],
        dailyFromOn: "2021-01-01",
      }),
    ).toMatchObject({ previous: null, changeBp: null });
    expect(
      buildCountryRiskBlock({ points: [], dailyFromOn: "2021-01-01" }),
    ).toEqual({
      days: [],
      months: [],
      latest: null,
      previous: null,
      changeBp: null,
    });
  });

  it("sends five years day by day and every month's last close", () => {
    const block = buildCountryRiskBlock({
      points: [
        point("2020-12-30", "1370"),
        point("2020-12-31", "1368"),
        point("2021-01-04", "1350"),
      ],
      dailyFromOn: "2021-01-01",
    });
    expect(block.days).toEqual([{ on: "2021-01-04", value: "1350" }]);
    expect(block.months).toEqual([
      { on: "2020-12-01", value: "1368" },
      { on: "2021-01-01", value: "1350" },
    ]);
  });
});

describe("country-risk-index-1.0.0", () => {
  it("dates the move from the EMBI+ to the EMBI Global Diversified", () => {
    expect(countryRiskIndexOn("1998-12-11")?.id).toBe("embi_plus");
    expect(countryRiskIndexOn("2025-09-29")?.id).toBe("embi_plus");
    expect(countryRiskIndexOn("2025-09-30")?.id).toBe(
      "embi_global_diversified",
    );
    expect(countryRiskIndexOn("1998-12-10")).toBeNull();
  });
});
