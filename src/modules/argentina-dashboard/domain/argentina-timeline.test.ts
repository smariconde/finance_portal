import { describe, expect, it } from "vitest";

import {
  PRESIDENTIAL_TERMS,
  REGIME_SPANS,
  regimesOverlapping,
  termOn,
  termsOverlapping,
} from "./argentina-timeline";

describe("argentina-timeline-1.0.0", () => {
  it("chains every presidency since 1983 without a gap or an overlap", () => {
    expect(PRESIDENTIAL_TERMS[0]?.from).toBe("1983-12-10");
    for (const [index, term] of PRESIDENTIAL_TERMS.entries()) {
      const next = PRESIDENTIAL_TERMS[index + 1];
      if (next === undefined) {
        expect(term.to).toBeNull();
      } else {
        expect(term.to).toBe(next.from);
        expect(term.from < term.to!).toBe(true);
      }
    }
    expect(new Set(PRESIDENTIAL_TERMS.map((term) => term.id)).size).toBe(
      PRESIDENTIAL_TERMS.length,
    );
  });

  it("keeps the regimes on the dates the transformation caveats use", () => {
    const byId = new Map(REGIME_SPANS.map((regime) => [regime.id, regime]));
    // `declared-transformation-caveats-1.0.0` ends each control the day
    // before the norm that lifted it.
    expect(byId.get("fx-controls-2011")).toMatchObject({
      from: "2011-10-31",
      to: "2015-12-17",
    });
    expect(byId.get("fx-controls-2019")).toMatchObject({
      from: "2019-09-01",
      to: "2025-04-14",
    });
    expect(byId.get("fx-bands-2025")?.from).toBe("2025-04-14");
    for (const regime of REGIME_SPANS) {
      expect(regime.source.length).toBeGreaterThan(0);
      if (regime.to !== null) expect(regime.from < regime.to).toBe(true);
    }
  });

  it("assigns the inauguration day to the incoming president", () => {
    expect(termOn("2023-12-09")?.id).toBe("alberto-fernandez");
    expect(termOn("2023-12-10")?.id).toBe("milei");
    expect(termOn("1983-12-09")).toBeNull();
  });

  it("finds the spans a range touches, with an exclusive end", () => {
    expect(
      termsOverlapping("2019-12-10", "2020-06-30").map((t) => t.id),
    ).toEqual(["alberto-fernandez"]);
    expect(
      termsOverlapping("2019-12-09", "2019-12-10").map((t) => t.id),
    ).toEqual(["macri", "alberto-fernandez"]);
    expect(regimesOverlapping("2016-01-01", "2019-08-31")).toEqual([]);
    expect(
      regimesOverlapping("2015-12-16", "2015-12-16").map((r) => r.id),
    ).toEqual(["indec-intervention", "fx-controls-2011"]);
  });
});
