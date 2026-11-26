import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, expect, it } from "vitest";

import type { CalendarEvent } from "@/modules/market-calendar/domain/calendar-publication";
import { createPostgresCalendarRepository } from "@/server/db/postgres-calendar-repository";
import { createPostgresIngestionJobStore } from "@/server/db/postgres-ingestion-job-store";
import * as schema from "@/server/db/schema";

const client = postgres(process.env.DATABASE_TEST_URL!, {
  max: 4,
  prepare: false,
});
const db = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

it("records changes once, preserves the previous date and excludes unpublished revisions", async () => {
  const calendar = createPostgresCalendarRepository(db);
  const datasetId = `calendar-test.${randomUUID()}`;
  const key = `test:${randomUUID()}`;
  const event = (date: string): CalendarEvent => ({
    kind: "economic",
    publication: {
      id: "10",
      title: "IPC",
      date,
      period: null,
      status: "scheduled",
    },
  });
  const record = (day: string, next: CalendarEvent) =>
    calendar.record(
      {
        runId: randomUUID(),
        sourceId: "fred",
        datasetId,
        day,
        parserVersion: "fred-test-1.0.0",
        startedAt: `${day}T11:00:00Z`,
        observedAt: `${day}T11:00:01Z`,
        recordedAt: `${day}T11:00:02Z`,
      },
      [{ key, event: next }],
    );

  const before = event("2026-12-08");
  const moved = event("2026-12-09");
  await record("2026-11-26", before);
  const [first, second] = await Promise.all([
    record("2026-11-27", moved),
    record("2026-11-27", moved),
  ]);
  expect(first).toEqual(second);
  await record("2026-11-28", moved);
  expect(await calendar.read(datasetId, "2026-11-27T11:00:01Z")).toMatchObject({
    events: [{ key, event: before, previous: null }],
  });
  expect(await calendar.read(datasetId, "2026-11-28T12:00:00Z")).toMatchObject({
    observedAt: "2026-11-28T11:00:01.000Z",
    events: [
      {
        key,
        event: moved,
        previous: before,
        observedAt: "2026-11-27T11:00:01.000Z",
      },
    ],
  });
});

it("reuses a completed daily job even when two requests open concurrently", async () => {
  const store = createPostgresIngestionJobStore(db, { newId: randomUUID });
  const now = "2026-11-26T11:00:00Z";
  const input = {
    kind: "market_calendar_refresh" as const,
    sourceId: "fred",
    datasetId: `calendar-test.${randomUUID()}`,
    parserVersion: "fred-test-1.0.0",
    selectionVersion: null,
    maxAttempts: 1,
    subjects: ["2026-11-26"],
  };
  const [a, b] = await Promise.all([
    store.createJob(input, { now }),
    store.createJob(input, { now }),
  ]);
  expect(a.job.jobId).toEqual(b.job.jobId);
  expect(Number(a.created) + Number(b.created)).toBe(1);
  await store.cancelJob(a.job.jobId, { now, reason: "test daily job" });
  const again = await store.createJob(input, { now });
  expect(again).toMatchObject({
    created: false,
    job: { jobId: a.job.jobId, status: "cancelled" },
  });
});
