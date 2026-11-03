import { describe, expect, it } from "vitest";

import { declaredArgentinaIndicator } from "./declared-argentina-indicators";
import {
  planArgentinaIndicator,
  type FetchedIndicatorPoint,
} from "./plan-argentina-indicator";

const indicator = declaredArgentinaIndicator("emae_sa")!;

function plan(
  fetched: readonly FetchedIndicatorPoint[],
  open: ReturnType<typeof planArgentinaIndicator>["observations"] = [],
) {
  return planArgentinaIndicator({
    indicator,
    currentDefinition: null,
    open,
    fetched,
    observedAt: "2026-11-03T21:00:00.000Z",
    recordedAt: "2026-11-03T21:00:01.000Z",
    runId: "run-2",
    acceptMassChange: false,
  });
}

describe("planArgentinaIndicator", () => {
  it("keeps the source's sign with the point it qualifies", () => {
    const first = plan([
      { periodOn: "2026-07-01", value: "100", note: null },
      { periodOn: "2026-08-01", value: "101", note: "*" },
    ]);
    expect(first.observations.map((point) => point.sourceNote)).toEqual([
      null,
      "*",
    ]);
  });

  it("revises a point whose sign changed even when its value did not", () => {
    const open = plan([
      { periodOn: "2026-08-01", value: "101", note: "*" },
    ]).observations;
    const next = planArgentinaIndicator({
      indicator,
      currentDefinition: null,
      open,
      fetched: [{ periodOn: "2026-08-01", value: "101", note: null }],
      observedAt: "2026-12-03T21:00:00.000Z",
      recordedAt: "2026-12-03T21:00:01.000Z",
      runId: "run-3",
      acceptMassChange: false,
    });
    expect(next.counts).toMatchObject({ revised: 1, unchanged: 0 });
    expect(next.observations[0]).toMatchObject({
      revision: 1,
      value: "101",
      sourceNote: null,
    });
  });

  it("records a missing value with its sign as a null, never a zero", () => {
    const result = plan([{ periodOn: "2004-01-01", value: null, note: "///" }]);
    expect(result.observations[0]).toMatchObject({
      value: null,
      missingReason: "source_null",
      sourceNote: "///",
    });
  });
});
