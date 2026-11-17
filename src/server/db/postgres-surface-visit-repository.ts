import "server-only";

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { SurfaceVisitRepository } from "@/modules/surface-visits/application/surface-visit-repository";
import {
  recordVisit,
  surfaceCodeSchema,
  surfaceVisitSchema,
  type SurfaceVisit,
} from "@/modules/surface-visits/domain/surface-visit";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type SurfaceVisitRow = typeof schema.surfaceVisits.$inferSelect;

function toDomain(row: SurfaceVisitRow): SurfaceVisit {
  return surfaceVisitSchema.parse({
    surface: row.surface,
    baselineAt: row.baselineAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
  });
}

/** The last view per surface (ADR 0079). */
export function createPostgresSurfaceVisitRepository(
  database: Database,
): SurfaceVisitRepository {
  const table = schema.surfaceVisits;

  return {
    async read(surface) {
      const rows = await database
        .select()
        .from(table)
        .where(eq(table.surface, surfaceCodeSchema.parse(surface)))
        .limit(1);
      return rows[0] ? toDomain(rows[0]) : null;
    },

    async record(surface, now) {
      const code = surfaceCodeSchema.parse(surface);
      return database.transaction(async (tx) => {
        // The row is created once; after that every view locks it, so two
        // tabs apply the rule one after the other.
        await tx
          .insert(table)
          .values({
            surface: code,
            baselineAt: null,
            lastSeenAt: new Date(now),
          })
          .onConflictDoNothing();
        const [locked] = await tx
          .select()
          .from(table)
          .where(eq(table.surface, code))
          .for("update");
        if (locked === undefined) throw new Error("surface_visit_missing");
        const next = recordVisit(code, toDomain(locked), now);
        await tx
          .update(table)
          .set({
            baselineAt:
              next.baselineAt === null ? null : new Date(next.baselineAt),
            lastSeenAt: new Date(next.lastSeenAt),
          })
          .where(eq(table.surface, code));
        return next;
      });
    },
  };
}
