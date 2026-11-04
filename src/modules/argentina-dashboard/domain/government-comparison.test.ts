import { describe, expect, it } from "vitest";

import type { PresidentialTerm } from "./argentina-timeline";
import {
  compareGovernments,
  type GovernmentPath,
} from "./government-comparison";

const TERMS: readonly PresidentialTerm[] = [
  {
    id: "a",
    label: "A",
    president: "A",
    from: "2019-12-10",
    to: "2020-03-10",
    kind: "elected",
  },
  {
    id: "interim",
    label: "I",
    president: "I",
    from: "2020-03-10",
    to: "2020-03-12",
    kind: "interim",
  },
  {
    id: "b",
    label: "B",
    president: "B",
    from: "2020-03-12",
    to: null,
    kind: "elected",
  },
];

function computed(path: GovernmentPath | undefined) {
  if (path?.status !== "computed") throw new Error("expected computed");
  return path;
}

describe("government-comparison-1.0.0", () => {
  it("indexes a daily series to the last close before taking office", () => {
    const paths = compareGovernments({
      terms: TERMS,
      frequency: "daily",
      basis: "index",
      points: [
        { on: "2019-12-06", value: "50" },
        { on: "2019-12-09", value: "60" },
        { on: "2019-12-31", value: "63" },
        { on: "2020-01-31", value: "66" },
        { on: "2020-02-28", value: "69" },
        { on: "2020-03-11", value: "75" },
        { on: "2020-03-31", value: "90" },
      ],
    });
    const a = computed(paths[0]);
    expect(a.baseOn).toBe("2019-12-09");
    expect(a.baseValue).toBe("60");
    // December counts for A; March, the successor's inauguration month, does not.
    expect(a.points.map((p) => [p.month, p.on, p.value])).toEqual([
      [0, "2019-12-01", "100"],
      [1, "2019-12-01", "105.000000"],
      [2, "2020-01-01", "110.000000"],
      [3, "2020-02-01", "115.000000"],
    ]);
    expect(a.running).toBe(false);
    expect(paths[1]).toEqual({
      termId: "interim",
      status: "unavailable",
      reason: "interim",
    });
    const b = computed(paths[2]);
    expect(b.baseOn).toBe("2020-03-11");
    expect(b.points.at(-1)).toEqual({
      month: 1,
      on: "2020-03-01",
      value: "120.000000",
    });
    expect(b.running).toBe(true);
  });

  it("names a term whose series starts after it took office", () => {
    const paths = compareGovernments({
      terms: TERMS,
      frequency: "daily",
      basis: "index",
      points: [{ on: "2020-01-15", value: "10" }],
    });
    expect(paths[0]).toMatchObject({
      status: "unavailable",
      reason: "no_base",
    });
    expect(paths[2]).toMatchObject({
      status: "unavailable",
      reason: "no_points",
    });
  });

  it("refuses an index from a non-positive base", () => {
    const paths = compareGovernments({
      terms: TERMS.slice(0, 1),
      frequency: "monthly",
      basis: "index",
      points: [
        { on: "2019-11-01", value: "0" },
        { on: "2019-12-01", value: "5" },
      ],
    });
    expect(paths[0]).toMatchObject({ reason: "non_positive_base" });
    const onlyInaugurationMonth = compareGovernments({
      terms: TERMS.slice(0, 1),
      frequency: "monthly",
      basis: "index",
      points: [
        { on: "2019-11-01", value: "4" },
        { on: "2019-12-01", value: "5" },
      ],
    });
    expect(onlyInaugurationMonth[0]).toMatchObject({ status: "computed" });
  });

  it("chains monthly inflation and stops at the first missing month", () => {
    const paths = compareGovernments({
      terms: TERMS.slice(0, 1),
      frequency: "monthly",
      basis: "cumulative_rate",
      points: [
        { on: "2019-11-01", value: "4" },
        { on: "2019-12-01", value: "10" },
        { on: "2020-01-01", value: "10" },
        { on: "2020-02-01", value: null },
      ],
    });
    const a = computed(paths[0]);
    expect(a.baseOn).toBe("2019-11-01");
    expect(a.points.map((p) => p.value)).toEqual([
      "100",
      "110.000000",
      "121.000000",
    ]);
  });

  it("adds flows from the inauguration month and keeps a gap in a difference", () => {
    const flows = [
      { on: "2019-11-01", value: "1" },
      { on: "2019-12-01", value: "-3" },
      { on: "2020-01-01", value: null },
      { on: "2020-02-01", value: "5" },
    ];
    const sum = computed(
      compareGovernments({
        terms: TERMS.slice(0, 1),
        frequency: "monthly",
        basis: "cumulative_sum",
        points: flows,
      })[0],
    );
    expect(sum.points.map((p) => p.value)).toEqual(["0", "-3.000000"]);

    const difference = computed(
      compareGovernments({
        terms: TERMS.slice(0, 1),
        frequency: "monthly",
        basis: "difference",
        points: flows,
      })[0],
    );
    expect(difference.points.map((p) => p.value)).toEqual([
      "0",
      "-4.000000",
      null,
      "4.000000",
    ]);
  });
});
