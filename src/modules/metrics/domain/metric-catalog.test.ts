import { describe, expect, it } from "vitest";

import {
  findMetric,
  METRIC_CATALOG,
  METRIC_CATALOG_VERSION,
  metricCatalogEntrySchema,
} from "./metric-catalog";
import { DIVERGENCE_VIEWS_VERSION } from "@/modules/divergences/domain/divergence-views";

import { SORTINO_FORMULA_VERSION } from "./sortino";

describe("metric catalog", () => {
  it("names each metric once", () => {
    const ids = METRIC_CATALOG.map((entry) => entry.metricId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds only what the sector matrices use", () => {
    expect(new Set(METRIC_CATALOG.map((entry) => entry.matrix))).toEqual(
      new Set(["risk", "divergence"]),
    );
  });

  it("computes the risk matrix axes with the versioned Sortino", () => {
    for (const metricId of ["sortino_2y", "sortino_5y"]) {
      expect(findMetric(metricId)).toMatchObject({
        status: "implemented",
        formulaVersion: SORTINO_FORMULA_VERSION,
        matrix: "risk",
      });
      expect(findMetric(metricId)?.nullReasons).toContain(
        "no_downside_observations",
      );
    }
  });

  it("computes the divergence metrics with the versioned views", () => {
    const divergence = METRIC_CATALOG.filter(
      (entry) => entry.matrix === "divergence",
    );

    expect(divergence.map((entry) => entry.metricId)).toEqual(
      expect.arrayContaining([
        "share_count_bias_pp",
        "fundamental_gap_pp",
        "per_share_gap_pp",
        "aggregate_gap_pp",
        "diluted_shares_cagr_pct",
      ]),
    );
    for (const entry of divergence) {
      expect(entry).toMatchObject({
        status: "implemented",
        formulaVersion: DIVERGENCE_VIEWS_VERSION,
      });
      expect(entry.nullReasons).toContain("non_positive_endpoint");
    }
  });

  it("refuses an implemented metric without a formula version", () => {
    expect(
      metricCatalogEntrySchema.safeParse({
        ...findMetric("sortino_2y"),
        formulaVersion: null,
      }).success,
    ).toBe(false);
  });

  it("returns null for a metric it does not hold", () => {
    expect(findMetric("pe_ratio")).toBeNull();
  });

  it("declares its version", () => {
    expect(METRIC_CATALOG_VERSION).toBe("metric-catalog-1.1.0");
  });
});
