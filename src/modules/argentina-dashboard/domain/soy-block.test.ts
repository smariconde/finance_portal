import { describe, expect, it } from "vitest";

import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import { declaredSoyIndicator } from "@/modules/macro-series/domain/declared-soy-indicators";

import { buildSoyBlock } from "./soy-block";

const KNOWN_AT = "2026-11-04T23:30:00.000Z";
const AVAILABLE = "2026-11-04T23:00:00.000Z";

function series(
  id: string,
  points: readonly (readonly [string, string | null])[],
) {
  const indicator = declaredSoyIndicator(id)!;
  return {
    indicator,
    points: points.map(([periodOn, value]): ArgentinaIndicatorVintage => ({
      indicatorId: id,
      periodOn,
      value,
      missingReason: value === null ? "source_null" : null,
      sourceNote: null,
      availableAt: AVAILABLE,
      recordedAt: AVAILABLE,
      revision: 0,
      segment: indicator.segment,
      sourceRunId: "run",
    })),
  };
}

const empty = (id: string) => series(id, []);

function block(overrides: Partial<Parameters<typeof buildSoyBlock>[0]> = {}) {
  return buildSoyBlock({
    rosario: series("soy_rosario_pizarra", [
      ["2026-10-28", "550000"],
      ["2026-10-29", null],
      ["2026-10-30", "560000"],
      ["2026-11-02", "542000"],
      ["2026-11-03", "540500"],
    ]),
    fx: series("usd_bna_divisas_buyer", [
      ["2026-10-28", "1533"],
      ["2026-10-29", "1530"],
      ["2026-10-30", "1525"],
      ["2026-11-02", "1536.5"],
      ["2026-11-03", "1542"],
    ]),
    chicago: series("soy_cbot_front", [
      ["2026-10-28", "1220"],
      ["2026-10-29", "1219.75"],
      ["2026-10-30", "1222.25"],
      ["2026-11-03", "1203"],
    ]),
    sown: series("soy_area_sown", [
      ["2024-07-01", "17994965"],
      ["2025-07-01", "16132498"],
    ]),
    harvested: empty("soy_area_harvested"),
    production: series("soy_production", [
      ["2024-07-01", "51107836"],
      ["2025-07-01", "49260376"],
    ]),
    yieldKgHa: empty("soy_yield"),
    knownAt: KNOWN_AT,
    ...overrides,
  });
}

describe("soy block", () => {
  it("reads the latest board day that has all three legs", () => {
    const { latest } = block();
    expect(latest).toMatchObject({
      on: "2026-11-03",
      rosarioArs: "540500",
      fx: "1542",
      chicagoCents: "1203",
      contract: "ZSX26",
      inDeliveryPeriod: true,
      firstNoticeOn: "2026-10-30",
      lastTradeOn: "2026-11-13",
    });
    // 540,500 / 1,542 = 350.52 USD/t against 12.03 × 36.7437 = 442.03.
    expect(Number(latest!.rosarioUsd)).toBeCloseTo(350.519, 3);
    expect(Number(latest!.chicagoUsd)).toBeCloseTo(442.0267, 3);
    expect(Number(latest!.basis)).toBeCloseTo(-20.7019, 3);
  });

  it("says which leg is missing instead of borrowing another day", () => {
    const days = new Map(block().days.map((day) => [day.on, day]));
    expect(days.get("2026-10-29")).toMatchObject({
      basis: null,
      reason: "missing_rosario",
    });
    expect(days.get("2026-11-02")).toMatchObject({
      chicagoCents: null,
      basis: null,
      reason: "missing_chicago",
    });
    expect(days.get("2026-10-28")).toMatchObject({
      contract: "ZSX26",
      inDeliveryPeriod: false,
    });
  });

  it("keeps each leg's own last date, even past the latest basis", () => {
    const { legs } = block({
      fx: series("usd_bna_divisas_buyer", [
        ["2026-11-03", "1542"],
        ["2026-11-04", "1550"],
      ]),
    });
    expect(legs).toEqual({
      rosario: { on: "2026-11-03", value: "540500" },
      fx: { on: "2026-11-04", value: "1550" },
      chicago: { on: "2026-11-03", value: "1203" },
    });
  });

  it("closes each month on its last computed basis", () => {
    const { months } = block();
    expect(months.map((month) => month.on)).toEqual([
      "2026-10-01",
      "2026-11-01",
    ]);
    expect(months[0]!.basis.closeOn).toBe("2026-10-30");
    expect(months[1]!.basis.closeOn).toBe("2026-11-03");
  });

  it("lists campaigns and compares production with the one before", () => {
    const { campaigns, productionChange } = block();
    expect(campaigns.map((item) => item.campaign)).toEqual([
      "2024/25",
      "2025/26",
    ]);
    expect(campaigns[1]).toMatchObject({
      sownHa: "16132498",
      harvestedHa: null,
      productionT: "49260376",
    });
    expect(productionChange).toMatchObject({
      campaign: "2025/26",
      previous: "2024/25",
      change: { status: "computed" },
    });
  });

  it("has nothing to say without data, and says nothing", () => {
    const nothing = block({
      rosario: empty("soy_rosario_pizarra"),
      sown: empty("soy_area_sown"),
      production: empty("soy_production"),
    });
    expect(nothing).toMatchObject({
      days: [],
      months: [],
      latest: null,
      campaigns: [],
      productionChange: null,
    });
  });
});
