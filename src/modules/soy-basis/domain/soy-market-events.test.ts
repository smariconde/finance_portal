import { describe, expect, it } from "vitest";

import {
  DECLARED_SOY_DUTY_CHANGES,
  soyDutyOn,
  soyHarvestSeasons,
} from "./soy-market-events";

describe("declared soy duty changes", () => {
  it("are strictly ordered, unique and cite their norm", () => {
    const ids = new Set(DECLARED_SOY_DUTY_CHANGES.map((change) => change.id));
    expect(ids.size).toBe(DECLARED_SOY_DUTY_CHANGES.length);
    DECLARED_SOY_DUTY_CHANGES.forEach((change, index) => {
      const next = DECLARED_SOY_DUTY_CHANGES[index + 1];
      if (next) expect(change.on < next.on).toBe(true);
      expect(Number.isFinite(Number(change.ratePct))).toBe(true);
      expect(change.norm).toMatch(/Decreto/);
    });
  });

  it("reads the rate in force on a day, and none before the list", () => {
    expect(soyDutyOn("2019-12-13")).toBeNull();
    expect(soyDutyOn("2019-12-14")?.ratePct).toBe("30");
    expect(soyDutyOn("2020-11-15")?.ratePct).toBe("31.5");
    expect(soyDutyOn("2023-11-24")?.ratePct).toBe("33");
    expect(soyDutyOn("2025-09-23")?.ratePct).toBe("0");
    expect(soyDutyOn("2025-09-25")?.ratePct).toBe("26");
    expect(soyDutyOn("2026-11-03")?.ratePct).toBe("24");
  });
});

describe("soyHarvestSeasons", () => {
  it("shades April through June of each year", () => {
    expect(soyHarvestSeasons(2025, 2026)).toEqual([
      {
        id: "harvest-2025",
        label: "Cosecha",
        from: "2025-04-01",
        to: "2025-07-01",
      },
      {
        id: "harvest-2026",
        label: "Cosecha",
        from: "2026-04-01",
        to: "2026-07-01",
      },
    ]);
    expect(soyHarvestSeasons(2026, 2025)).toEqual([]);
  });
});
