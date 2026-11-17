import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { VISIT_SESSION_GAP_MS } from "@/modules/surface-visits/domain/surface-visit";
import { createPostgresSurfaceVisitRepository } from "@/server/db/postgres-surface-visit-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

let client: Sql;
let database: PostgresJsDatabase<typeof schema>;

const T0 = "2026-11-10T12:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

describe("PostgreSQL surface visits (ADR 0079)", () => {
  beforeAll(() => {
    client = postgres(databaseTestUrl, { max: 4, onnotice: () => {} });
    database = drizzle(client, { schema });
  });

  afterAll(async () => {
    await database
      .delete(schema.surfaceVisits)
      .where(eq(schema.surfaceVisits.surface, "argentina"));
    await client.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.surfaceVisits)
      .where(eq(schema.surfaceVisits.surface, "argentina"));
  });

  it("creates the row on the first view and moves the baseline per session", async () => {
    const visits = createPostgresSurfaceVisitRepository(database);
    expect(await visits.read("argentina")).toBeNull();

    expect(await visits.record("argentina", T0)).toEqual({
      surface: "argentina",
      baselineAt: null,
      lastSeenAt: T0,
    });
    await visits.record("argentina", at(60_000));
    expect(await visits.read("argentina")).toEqual({
      surface: "argentina",
      baselineAt: null,
      lastSeenAt: at(60_000),
    });

    const nextSession = at(60_000 + VISIT_SESSION_GAP_MS + 1);
    expect(await visits.record("argentina", nextSession)).toEqual({
      surface: "argentina",
      baselineAt: at(60_000),
      lastSeenAt: nextSession,
    });
  });

  it("applies concurrent views one after the other", async () => {
    const visits = createPostgresSurfaceVisitRepository(database);
    await visits.record("argentina", T0);
    const later = Array.from({ length: 6 }, (_, index) =>
      at(VISIT_SESSION_GAP_MS + 1 + index * 1_000),
    );
    await Promise.all(later.map((now) => visits.record("argentina", now)));
    // Whatever the order, the session that opened after T0 compares with T0.
    expect(await visits.read("argentina")).toEqual({
      surface: "argentina",
      baselineAt: T0,
      lastSeenAt: later.at(-1),
    });
  });

  it("refuses a surface outside the declared set and a baseline after the view", async () => {
    await expect(
      client`insert into surface_visits (surface, baseline_at, last_seen_at)
             values ('sectores', null, now())`,
    ).rejects.toThrow(/surface_visits_surface_check/u);
    await expect(
      client`insert into surface_visits (surface, baseline_at, last_seen_at)
             values ('argentina', now(), now() - interval '1 minute')`,
    ).rejects.toThrow(/surface_visits_timeline_check/u);
  });
});
