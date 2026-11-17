import { describe, expect, it } from "vitest";

import {
  recordVisit,
  surfaceVisitSchema,
  visitBaseline,
  VISIT_SESSION_GAP_MS,
  type SurfaceVisit,
} from "./surface-visit";

const T0 = "2026-11-10T12:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

describe("surface-visit-1.0.0", () => {
  it("compares against nothing during the first session", () => {
    expect(visitBaseline(null, T0)).toBeNull();
    const first = recordVisit("argentina", null, T0);
    expect(first).toEqual({
      surface: "argentina",
      baselineAt: null,
      lastSeenAt: T0,
    });
    // A reload inside the first session still has nothing to compare with.
    expect(visitBaseline(first, at(10 * 60_000))).toBeNull();
  });

  it("keeps the baseline while the session lasts", () => {
    const visit: SurfaceVisit = {
      surface: "argentina",
      baselineAt: "2026-11-03T09:00:00.000Z",
      lastSeenAt: T0,
    };
    const reload = at(VISIT_SESSION_GAP_MS);
    expect(visitBaseline(visit, reload)).toBe("2026-11-03T09:00:00.000Z");
    expect(recordVisit("argentina", visit, reload)).toEqual({
      surface: "argentina",
      baselineAt: "2026-11-03T09:00:00.000Z",
      lastSeenAt: reload,
    });
  });

  it("starts a new session from the last view of the previous one", () => {
    const visit: SurfaceVisit = {
      surface: "argentina",
      baselineAt: "2026-11-03T09:00:00.000Z",
      lastSeenAt: T0,
    };
    const later = at(VISIT_SESSION_GAP_MS + 1);
    expect(visitBaseline(visit, later)).toBe(T0);
    expect(recordVisit("argentina", visit, later)).toEqual({
      surface: "argentina",
      baselineAt: T0,
      lastSeenAt: later,
    });
  });

  it("never moves the last view back when the clock does", () => {
    const visit: SurfaceVisit = {
      surface: "argentina",
      baselineAt: null,
      lastSeenAt: T0,
    };
    const earlier = at(-5 * 60_000);
    expect(visitBaseline(visit, earlier)).toBeNull();
    expect(recordVisit("argentina", visit, earlier).lastSeenAt).toBe(T0);
  });

  it("rejects a baseline after the last view and an unknown surface", () => {
    expect(
      surfaceVisitSchema.safeParse({
        surface: "argentina",
        baselineAt: at(1),
        lastSeenAt: T0,
      }).success,
    ).toBe(false);
    expect(
      surfaceVisitSchema.safeParse({
        surface: "sectores",
        baselineAt: null,
        lastSeenAt: T0,
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed instant", () => {
    expect(() => visitBaseline(null, "ayer")).toThrow();
    expect(() => recordVisit("argentina", null, "ayer")).toThrow();
  });
});
