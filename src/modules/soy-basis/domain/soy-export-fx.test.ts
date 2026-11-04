import { describe, expect, it } from "vitest";

import {
  calculateSoyEffectiveBasis,
  DECLARED_SOY_EXPORT_FX_REGIMES,
  soyExportFxRegimeOn,
} from "./soy-export-fx";

describe("declared soy export FX regimes", () => {
  it("are ordered, non-overlapping and well formed", () => {
    DECLARED_SOY_EXPORT_FX_REGIMES.forEach((regime, index) => {
      expect(regime.from < regime.to).toBe(true);
      const next = DECLARED_SOY_EXPORT_FX_REGIMES[index + 1];
      if (next) expect(regime.to <= next.from).toBe(true);
      if (regime.rule.kind === "blend") {
        const share = Number(regime.rule.officialShare);
        expect(share > 0 && share < 1).toBe(true);
      }
      expect(regime.norm).toMatch(/Decreto|DNU/);
    });
  });

  it("finds a day's span with inclusive start and exclusive end", () => {
    expect(soyExportFxRegimeOn("2022-09-05")?.id).toBe("dolar-soja-1");
    expect(soyExportFxRegimeOn("2022-09-30")?.id).toBe("dolar-soja-1");
    expect(soyExportFxRegimeOn("2022-10-01")).toBeNull();
    expect(soyExportFxRegimeOn("2023-10-22")?.id).toBe("pie-75-25");
    expect(soyExportFxRegimeOn("2023-10-23")?.id).toBe("pie-70-30");
    expect(soyExportFxRegimeOn("2023-12-12")).toBeNull();
    expect(soyExportFxRegimeOn("2025-04-11")?.id).toBe("blend-80-20");
    expect(soyExportFxRegimeOn("2025-04-14")).toBeNull();
  });
});

describe("calculateSoyEffectiveBasis", () => {
  const base = {
    rosarioArs: "240000",
    bnaBuyer: "356.6",
    ccl: "950",
    chicagoUsdPerTon: "489",
  };

  it("reads the official BNA rate outside every span", () => {
    const result = calculateSoyEffectiveBasis({
      ...base,
      on: "2026-11-03",
      rosarioArs: "540500",
      bnaBuyer: "1542",
      chicagoUsdPerTon: "442.03",
    });
    expect(result).toMatchObject({
      status: "computed",
      regimeId: "official",
      pesosPerDollar: "1542",
    });
    if (result.status !== "computed") throw new Error("expected computed");
    expect(Number(result.basisPct)).toBeCloseTo(-20.7, 1);
  });

  it("uses a program's fixed rate and ignores the official one", () => {
    const result = calculateSoyEffectiveBasis({
      ...base,
      on: "2022-12-01",
      rosarioArs: "70000",
      bnaBuyer: null,
      ccl: null,
      chicagoUsdPerTon: "530",
    });
    expect(result).toMatchObject({
      status: "computed",
      regimeId: "dolar-soja-2",
      pesosPerDollar: "230",
    });
  });

  it("blends the official share with the same day's CCL", () => {
    // 2023-11-24 read +37.6 % at the official rate; with an illustrative CCL
    // of 950 the 50/50 rate is 653.3 pesos per dollar.
    const result = calculateSoyEffectiveBasis({ ...base, on: "2023-11-24" });
    if (result.status !== "computed") throw new Error("expected computed");
    expect(result.regimeId).toBe("pie-50-50");
    expect(result.pesosPerDollar).toBe("653.3");
    expect(Number(result.basisPct)).toBeCloseTo(-24.87, 2);
  });

  it("names a blended day without a CCL instead of borrowing one", () => {
    expect(
      calculateSoyEffectiveBasis({ ...base, on: "2024-03-01", ccl: null }),
    ).toEqual({ status: "unavailable", reason: "missing_ccl" });
  });

  it("names a missing leg and refuses non-positive inputs", () => {
    expect(
      calculateSoyEffectiveBasis({
        ...base,
        on: "2026-01-05",
        rosarioArs: null,
      }),
    ).toEqual({ status: "unavailable", reason: "missing_leg" });
    expect(
      calculateSoyEffectiveBasis({ ...base, on: "2026-01-05", bnaBuyer: null }),
    ).toEqual({ status: "unavailable", reason: "missing_leg" });
    expect(
      calculateSoyEffectiveBasis({
        ...base,
        on: "2026-01-05",
        chicagoUsdPerTon: null,
      }),
    ).toEqual({ status: "unavailable", reason: "missing_leg" });
    expect(
      calculateSoyEffectiveBasis({
        ...base,
        on: "2026-01-05",
        rosarioArs: "0",
      }),
    ).toEqual({ status: "unavailable", reason: "non_positive_input" });
    expect(
      calculateSoyEffectiveBasis({ ...base, on: "2024-03-01", ccl: "-1" }),
    ).toEqual({ status: "unavailable", reason: "non_positive_input" });
    expect(
      calculateSoyEffectiveBasis({
        ...base,
        on: "2026-01-05",
        chicagoUsdPerTon: "0",
      }),
    ).toEqual({ status: "unavailable", reason: "non_positive_input" });
  });

  it("throws on a non-finite input", () => {
    expect(() =>
      calculateSoyEffectiveBasis({
        ...base,
        on: "2026-01-05",
        bnaBuyer: "NaN",
      }),
    ).toThrow();
  });
});
