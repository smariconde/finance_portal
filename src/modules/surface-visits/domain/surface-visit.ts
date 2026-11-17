import { z } from "zod";

/**
 * When the owner last looked at a surface, so it can mark what arrived since
 * (`surface-visit-1.0.0`, ADR 0079). One row per surface: it is a reading
 * aid, not evidence, so it is overwritten and never versioned.
 *
 * A visit is a **session**: views closer than `VISIT_SESSION_GAP_MS` to the
 * previous one belong to it. The baseline of a session is the last view of
 * the session before, and it does not move while the session lasts, so a
 * reload or the page re-read after a refresh keeps the same marks.
 */
export const SURFACE_VISIT_VERSION = "surface-visit-1.0.0";

/** Surfaces that remember a visit. Closed: an action never names another. */
export const SURFACE_CODES = ["argentina"] as const;

export const surfaceCodeSchema = z.enum(SURFACE_CODES);

export type SurfaceCode = z.infer<typeof surfaceCodeSchema>;

/** Views further apart than this start a new session. */
export const VISIT_SESSION_GAP_MS = 30 * 60_000;

const instantSchema = z.iso.datetime({ offset: true });

export const surfaceVisitSchema = z
  .object({
    surface: surfaceCodeSchema,
    /** The last view of the previous session; `null` during the first one. */
    baselineAt: instantSchema.nullable(),
    /** The latest view of the current session. */
    lastSeenAt: instantSchema,
  })
  .strict()
  .refine(
    (visit) =>
      visit.baselineAt === null ||
      Date.parse(visit.baselineAt) <= Date.parse(visit.lastSeenAt),
    { message: "baseline_after_last_seen" },
  );

export type SurfaceVisit = z.infer<typeof surfaceVisitSchema>;

function sameSession(visit: SurfaceVisit, nowMs: number): boolean {
  // A clock that moved back stays in the session: it never invents a gap.
  return nowMs - Date.parse(visit.lastSeenAt) <= VISIT_SESSION_GAP_MS;
}

/**
 * The instant a view at `now` compares against. Pure and without writes: the
 * render reads it and the action records the view afterwards. `null` means
 * there is nothing to compare with yet —the first session ever— and nothing
 * is marked.
 */
export function visitBaseline(
  visit: SurfaceVisit | null,
  now: string,
): string | null {
  const nowMs = Date.parse(instantSchema.parse(now));
  if (visit === null) return null;
  return sameSession(visit, nowMs) ? visit.baselineAt : visit.lastSeenAt;
}

/** The row after a view at `now`. */
export function recordVisit(
  surface: SurfaceCode,
  visit: SurfaceVisit | null,
  now: string,
): SurfaceVisit {
  const nowMs = Date.parse(instantSchema.parse(now));
  if (visit === null) {
    return surfaceVisitSchema.parse({
      surface,
      baselineAt: null,
      lastSeenAt: now,
    });
  }
  const lastSeenMs = Math.max(Date.parse(visit.lastSeenAt), nowMs);
  return surfaceVisitSchema.parse({
    surface,
    baselineAt: visitBaseline(visit, now),
    lastSeenAt: new Date(lastSeenMs).toISOString(),
  });
}
