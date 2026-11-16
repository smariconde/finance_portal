import { describe, expect, it } from "vitest";

import {
  SECTOR_RISK_QUALITY_VERSION,
  type SectorRiskQuality,
} from "@/modules/metrics/domain/sector-risk-quality";

import { qualityVerdict } from "./quality-verdict";

function quality(overrides: Partial<SectorRiskQuality>): SectorRiskQuality {
  return {
    ruleVersion: SECTOR_RISK_QUALITY_VERSION,
    status: "ready",
    score: 100,
    population: 73,
    computed2y: 73,
    computed5y: 73,
    comparable: 73,
    seriesWithoutRows: 0,
    daysSinceClose: 3,
    components: {
      completeness: 100,
      freshness: 100,
      comparability: 100,
      validation: 100,
      agreement: null,
    },
    ...overrides,
  };
}

describe("qualityVerdict", () => {
  it("a complete matrix names no reason", () => {
    expect(qualityVerdict(quality({}))).toEqual({
      state: "ready",
      score: "100/100",
      reasons: [],
    });
  });

  it("names the securities without a Sortino instead of a bare «degraded»", () => {
    // Information Technology: 71 de 73 con ambas ventanas, 98/100.
    const verdict = qualityVerdict(
      quality({
        status: "degraded",
        score: 98,
        computed5y: 71,
        comparable: 71,
        components: {
          completeness: 99,
          freshness: 100,
          comparability: 97,
          validation: 100,
          agreement: null,
        },
      }),
    );

    expect(verdict).toEqual({
      state: "degraded",
      score: "98/100",
      reasons: ["2 sin Sortino"],
    });
  });

  it("counts securities without prices once, before the missing Sortinos", () => {
    const verdict = qualityVerdict(
      quality({
        status: "degraded",
        score: 90,
        comparable: 68,
        seriesWithoutRows: 4,
      }),
    );

    expect(verdict.reasons).toEqual(["4 sin precios", "1 sin Sortino"]);
  });

  it("names a stale close and a reference without Sortino", () => {
    const verdict = qualityVerdict(
      quality({
        status: "degraded",
        score: 50,
        daysSinceClose: 1,
        components: {
          completeness: 100,
          freshness: 50,
          comparability: 0,
          validation: 100,
          agreement: null,
        },
      }),
    );

    expect(verdict.reasons).toEqual([
      "Cierre de hace 1 día",
      "Referencia sin Sortino",
    ]);
  });

  it("does not blame the reference when no security has both windows", () => {
    // Energy con precios viejos: 21 sin cierre en la fecha, referencia al día.
    const verdict = qualityVerdict(
      quality({
        status: "degraded",
        score: 40,
        population: 21,
        computed2y: 0,
        computed5y: 0,
        comparable: 0,
        components: {
          completeness: 0,
          freshness: 100,
          comparability: 0,
          validation: 100,
          agreement: null,
        },
      }),
    );

    expect(verdict.reasons).toEqual(["21 sin Sortino"]);
  });

  it("an empty sector has no score", () => {
    expect(
      qualityVerdict(
        quality({ status: "degraded", score: null, population: 0 }),
      ),
    ).toEqual({ state: "empty", score: null, reasons: ["Sector vacío"] });
  });

  it("falls back to «Degradada» if no component explains it", () => {
    expect(
      qualityVerdict(quality({ status: "degraded", score: 100 })).reasons,
    ).toEqual(["Degradada"]);
  });
});
