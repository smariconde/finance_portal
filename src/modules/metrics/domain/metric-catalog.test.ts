import { describe, expect, it } from "vitest";

import {
  findMetric,
  METRIC_CATALOG,
  METRIC_CATALOG_VERSION,
  metricCatalogEntrySchema,
} from "./metric-catalog";
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

  it("names the divergence metrics without pretending they are computed", () => {
    const divergence = METRIC_CATALOG.filter(
      (entry) => entry.matrix === "divergence",
    );

    expect(divergence.map((entry) => entry.metricId)).toContain(
      "share_count_bias_pp",
    );
    expect(
      divergence.every(
        (entry) => entry.status === "planned" && entry.formulaVersion === null,
      ),
    ).toBe(true);
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
    expect(METRIC_CATALOG_VERSION).toBe("metric-catalog-1.0.0");
  });
});
