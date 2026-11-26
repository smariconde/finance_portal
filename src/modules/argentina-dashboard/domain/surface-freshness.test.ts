import { describe, expect, it } from "vitest";

import {
  SUMMARY_CADENCE,
  SUMMARY_ORDER,
  type SummaryCadence,
} from "./summary-change";
import {
  BLOCK_FRESHNESS_GROUP,
  FRESHNESS_GROUP_SOURCES,
  groupFreshness,
  mergeSourceFreshness,
  newlySettledSources,
  SUMMARY_FRESHNESS_GROUP,
  type SourceFreshness,
} from "./surface-freshness";

function source(
  sourceId: string,
  state: SourceFreshness["state"],
  checkedAt: string | null = "2026-11-26T12:00:00.000Z",
): SourceFreshness {
  return { sourceId, label: sourceId.toUpperCase(), state, checkedAt };
}

const ALL_CHECKED = [
  source("bcra-monetarias-v4", "checked", "2026-11-26T10:00:00.000Z"),
  source("yahoo-finance", "checked", "2026-11-26T11:00:00.000Z"),
  source("indec-api", "checked"),
  source("argentina-series-tiempo", "checked"),
  source("bcr-cac-pizarra", "checked"),
  source("bna-fx", "checked"),
  source("magyp-estimaciones", "checked"),
  source("ambito-riesgo-pais", "checked"),
];

function withState(
  sourceId: string,
  state: SourceFreshness["state"],
): readonly SourceFreshness[] {
  return ALL_CHECKED.map((entry) =>
    entry.sourceId === sourceId ? { ...entry, state } : entry,
  );
}

describe("groupFreshness", () => {
  it("is verified with its oldest check when every source answered", () => {
    expect(groupFreshness("dollar", ALL_CHECKED)).toEqual({
      state: "verified",
      checkedAt: "2026-11-26T10:00:00.000Z",
    });
  });

  it("has no instant when one of its sources has none", () => {
    expect(
      groupFreshness(
        "dollar",
        ALL_CHECKED.map((entry) =>
          entry.sourceId === "yahoo-finance"
            ? { ...entry, checkedAt: null }
            : entry,
        ),
      ),
    ).toEqual({ state: "verified", checkedAt: null });
  });

  it("is verifying while any of its sources is pending, before a failure", () => {
    const sources = withState("yahoo-finance", "pending").map((entry) =>
      entry.sourceId === "bcr-cac-pizarra"
        ? { ...entry, state: "failed" as const }
        : entry,
    );
    expect(groupFreshness("soy", sources)).toEqual({
      state: "verifying",
      sources: ["YAHOO-FINANCE"],
    });
  });

  it("is unverified when a source failed or is blocked", () => {
    expect(
      groupFreshness("activity", withState("indec-api", "blocked")),
    ).toEqual({ state: "unverified", sources: ["INDEC-API"] });
    expect(
      groupFreshness("trade", withState("argentina-series-tiempo", "failed")),
    ).toEqual({ state: "unverified", sources: ["ARGENTINA-SERIES-TIEMPO"] });
  });

  it("only looks at the sources the group reads", () => {
    expect(
      groupFreshness("activity", withState("ambito-riesgo-pais", "failed")),
    ).toMatchObject({ state: "verified" });
  });

  it("is manual for the ITCRM and the REM, whatever the sources say", () => {
    expect(groupFreshness("itcrm", [])).toEqual({ state: "manual" });
    expect(groupFreshness("rem", ALL_CHECKED)).toEqual({ state: "manual" });
  });

  it("claims nothing when a source is unknown", () => {
    expect(groupFreshness("dollar", [])).toBeNull();
  });
});

describe("the page's mapping", () => {
  it("gives every tile and every block a group", () => {
    const groups = new Set(Object.keys(FRESHNESS_GROUP_SOURCES));
    for (const group of [
      ...Object.values(SUMMARY_FRESHNESS_GROUP),
      ...Object.values(BLOCK_FRESHNESS_GROUP),
    ]) {
      expect(groups.has(group)).toBe(true);
    }
    expect(Object.keys(BLOCK_FRESHNESS_GROUP)).toHaveLength(9);
  });

  it("orders the tiles from daily to monthly, each tile once", () => {
    const rank: Record<SummaryCadence, number> = {
      daily: 0,
      monthly: 1,
      annual: 2,
    };
    const ranks = SUMMARY_ORDER.map((metric) => rank[SUMMARY_CADENCE[metric]]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(SUMMARY_ORDER).size).toBe(SUMMARY_ORDER.length);
    expect([...SUMMARY_ORDER].sort()).toEqual(
      Object.keys(SUMMARY_CADENCE).sort(),
    );
  });
});

describe("mergeSourceFreshness", () => {
  it("keeps the render without live progress", () => {
    expect(mergeSourceFreshness(ALL_CHECKED, null)).toBe(ALL_CHECKED);
  });

  it("overrides source by source with what the refresh reported", () => {
    const rendered = withState("indec-api", "pending");
    const merged = mergeSourceFreshness(rendered, [
      source("indec-api", "checked", "2026-11-26T13:00:00.000Z"),
    ]);
    expect(merged.find((entry) => entry.sourceId === "indec-api")).toEqual(
      source("indec-api", "checked", "2026-11-26T13:00:00.000Z"),
    );
    expect(merged).toHaveLength(rendered.length);
  });

  it("keeps the rendered instant when a live check has none", () => {
    const merged = mergeSourceFreshness(ALL_CHECKED, [
      source("bna-fx", "checked", null),
    ]);
    expect(merged.find((entry) => entry.sourceId === "bna-fx")).toEqual(
      ALL_CHECKED.find((entry) => entry.sourceId === "bna-fx"),
    );
  });
});

describe("newlySettledSources", () => {
  it("names the sources that went from pending to checked or failed", () => {
    const before = withState("indec-api", "pending").map((entry) =>
      entry.sourceId === "bna-fx"
        ? { ...entry, state: "pending" as const }
        : entry,
    );
    const after = withState("bna-fx", "failed");
    expect(newlySettledSources(before, after)).toEqual(["indec-api", "bna-fx"]);
    expect(newlySettledSources(after, after)).toEqual([]);
  });
});
