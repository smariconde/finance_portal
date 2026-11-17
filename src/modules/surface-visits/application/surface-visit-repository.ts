import type { SurfaceCode, SurfaceVisit } from "../domain/surface-visit";

/**
 * Where the last view of each surface lives (ADR 0079). `record` reads,
 * applies `recordVisit` and writes in one step, so two tabs opening at once
 * never lose a view nor move the baseline twice.
 */
export interface SurfaceVisitRepository {
  read(surface: SurfaceCode): Promise<SurfaceVisit | null>;
  record(surface: SurfaceCode, now: string): Promise<SurfaceVisit>;
}
