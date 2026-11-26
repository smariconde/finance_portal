import "server-only";

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  computeIdempotencyKey,
  ingestionRunSchema,
} from "@/modules/ingestion/domain/ingestion-run";
import {
  calendarEventSchema,
  type CalendarEvent,
  type CalendarRevision,
} from "@/modules/market-calendar/domain/calendar-publication";

import { toIngestionRunRow } from "./postgres-ingestion-run-repository";
import * as schema from "./schema";

const { calendarEventRevisions: revisions, ingestionRuns: runs } = schema;

export type CalendarCapture = {
  readonly runId: string;
  readonly sourceId: string;
  readonly datasetId: string;
  readonly parserVersion: string;
  readonly day: string;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly recordedAt: string;
};

type RevisionRow = { readonly key: string; readonly event: CalendarEvent };

export function createPostgresCalendarRepository(
  db: PostgresJsDatabase<typeof schema>,
) {
  return {
    async record(
      capture: CalendarCapture,
      events: readonly RevisionRow[],
    ): Promise<string> {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(1202, hashtext(${capture.datasetId}))`,
        );
        const idempotencyKey = computeIdempotencyKey({
          ...capture,
          requestedAsOf: capture.day,
          cursor: null,
        });
        const [existing] = await tx
          .select({ id: runs.runId })
          .from(runs)
          .where(eq(runs.idempotencyKey, idempotencyKey))
          .limit(1);
        if (existing) return existing.id;

        const latest = await tx
          .selectDistinctOn([revisions.eventKey], {
            eventKey: revisions.eventKey,
            revision: revisions.revision,
            event: revisions.event,
          })
          .from(revisions)
          .innerJoin(runs, eq(runs.runId, revisions.runId))
          .where(eq(runs.datasetId, capture.datasetId))
          .orderBy(revisions.eventKey, desc(revisions.revision));
        const byKey = new Map(latest.map((row) => [row.eventKey, row]));
        const changes = events.flatMap(({ key, event }) => {
          const prior = byKey.get(key);
          return prior &&
            computeContentHash(prior.event) === computeContentHash(event)
            ? []
            : [
                {
                  eventKey: key,
                  event,
                  revision: (prior?.revision ?? 0) + 1,
                  runId: capture.runId,
                },
              ];
        });
        const run = ingestionRunSchema.parse({
          ...capture,
          idempotencyKey,
          requestedAsOf: capture.day,
          cursor: null,
          nextCursor: null,
          status: events.length === 0 ? "empty" : "succeeded",
          finishedAt: capture.observedAt,
          failure: null,
          counts: {
            fetched: events.length,
            accepted: events.length,
            rejected: 0,
            duplicate: 0,
          },
          contentHash: computeContentHash(events),
          qualityFlags: changes.length === 0 ? ["unchanged_calendar"] : [],
          replayOfRunId: null,
        });
        await tx.insert(runs).values(toIngestionRunRow(run));
        for (let offset = 0; offset < changes.length; offset += 1000) {
          await tx
            .insert(revisions)
            .values(changes.slice(offset, offset + 1000));
        }
        return run.runId;
      });
    },

    /** Current effective calendar read with an explicit as-known cutoff. */
    async read(
      datasetId: string,
      knownAt: string,
    ): Promise<{
      readonly observedAt: string | null;
      readonly events: readonly CalendarRevision[];
    }> {
      const cutoff = new Date(knownAt);
      const captured = and(
        eq(runs.datasetId, datasetId),
        lte(runs.recordedAt, cutoff),
        lte(runs.finishedAt, cutoff),
        inArray(runs.status, ["succeeded", "empty"]),
      );
      const ranked = db
        .select({
          key: revisions.eventKey,
          event: revisions.event,
          observedAt: runs.finishedAt,
          rank: sql<number>`row_number() over (partition by ${revisions.eventKey} order by ${revisions.revision} desc)`.as(
            "rank",
          ),
          previous:
            sql<unknown>`lead(${revisions.event}) over (partition by ${revisions.eventKey} order by ${revisions.revision} desc)`.as(
              "previous",
            ),
        })
        .from(revisions)
        .innerJoin(runs, eq(runs.runId, revisions.runId))
        .where(captured)
        .as("known_revisions");
      const [[capture], events] = await Promise.all([
        db
          .select({ observedAt: runs.finishedAt })
          .from(runs)
          .where(captured)
          .orderBy(desc(runs.recordedAt))
          .limit(1),
        db.select().from(ranked).where(eq(ranked.rank, 1)),
      ]);
      return {
        observedAt: capture?.observedAt?.toISOString() ?? null,
        events: events.map((row) => ({
          key: row.key,
          event: calendarEventSchema.parse(row.event),
          previous:
            row.previous === null
              ? null
              : calendarEventSchema.parse(row.previous),
          observedAt: row.observedAt!.toISOString(),
        })),
      };
    },
  };
}
