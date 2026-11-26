import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  readCalendarResource,
  type CalendarSource,
} from "@/modules/market-calendar/application/live-calendar-source";
import {
  EARNINGS_CALENDAR_DATASET,
  EARNINGS_CALENDAR_PARSER,
  EARNINGS_CALENDAR_URL,
  earningsReportKey,
  parseEarningsCalendar,
} from "@/modules/market-calendar/domain/earnings-calendar";
import type { CalendarEvent } from "@/modules/market-calendar/domain/calendar-publication";
import {
  calendarDateIn,
  NEW_YORK,
} from "@/modules/market-calendar/domain/zoned-time";
import { createPostgresCalendarRepository } from "@/server/db/postgres-calendar-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";
import { credentialProblem } from "@/server/egress/fetch-approved-resource";
import { getMeteredEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getIngestionJobStore } from "@/server/persistence/get-ingestion-job-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

export const EARNINGS_SOURCE: CalendarSource = {
  sourceId: "alpha-vantage",
  datasetId: EARNINGS_CALENDAR_DATASET,
  parserVersion: EARNINGS_CALENDAR_PARSER,
  url: EARNINGS_CALENDAR_URL,
  zone: NEW_YORK,
  credential: "ALPHA_VANTAGE_API_KEY",
};

type CalendarReader = (input: {
  readonly read: (url?: string) => ReturnType<typeof readCalendarResource>;
  readonly day: string;
  readonly startedAt: string;
}) => Promise<{
  readonly observedAt: string;
  readonly events: readonly {
    readonly key: string;
    readonly event: CalendarEvent;
  }[];
}>;

const now = () => new Date().toISOString();

export async function refreshDailyCalendar(
  source: CalendarSource,
  parse: CalendarReader,
): Promise<boolean> {
  // Checked before opening the database; the egress door attaches the key.
  if (
    source.credential &&
    credentialProblem(process.env[source.credential]) !== null
  )
    return false;
  const store = getIngestionJobStore();
  const day = calendarDateIn(now(), source.zone);
  const { job } = await store.createJob(
    {
      kind: "market_calendar_refresh",
      sourceId: source.sourceId,
      datasetId: source.datasetId,
      parserVersion: source.parserVersion,
      selectionVersion: null,
      subjects: [day],
      maxAttempts: 1,
    },
    { now: now() },
  );
  if (job.status !== "open") return false;

  const registry = getSourceRegistryRepository();
  await syncDeclaredSourceRegistry(
    DEMO_SOURCE_REGISTRY.filter((entry) => entry.sourceId === source.sourceId),
    registry,
  );

  const result = await runIngestionJob(
    { jobId: job.jobId, holder: `web/${process.pid}/${randomUUID()}` },
    {
      store,
      now,
      sleep: (ms) => sleep(ms),
      newLeaseToken: randomUUID,
      startHeartbeat(beat, intervalMs) {
        const timer = setInterval(() => void beat(), intervalMs);
        timer.unref();
        return () => clearInterval(timer);
      },
      async execute(item) {
        const startedAt = now();
        if (calendarDateIn(startedAt, source.zone) !== item.subjectKey) {
          return { kind: "subject_rejected", message: "calendar_day_elapsed" };
        }
        const fetch = getMeteredEgressFetch();
        const { observedAt, events } = await parse({
          read: (url) => readCalendarResource(source, registry, fetch, url),
          day,
          startedAt,
        });
        const ingestionRunId = await createPostgresCalendarRepository(
          getRuntimeDatabase(),
        ).record(
          {
            runId: randomUUID(),
            sourceId: source.sourceId,
            datasetId: source.datasetId,
            parserVersion: source.parserVersion,
            day,
            startedAt,
            observedAt,
            recordedAt: now(),
          },
          events,
        );
        return { kind: "ingested", ingestionRunId };
      },
    },
  );
  return result.attempts.some((attempt) => attempt.outcome.kind === "ingested");
}

export async function refreshEarningsCalendar(): Promise<boolean> {
  return refreshDailyCalendar(EARNINGS_SOURCE, async ({ read }) => {
    const { text, observedAt } = await read();
    return {
      observedAt,
      events: parseEarningsCalendar(text).map((report) => ({
        key: `av:${earningsReportKey(report)}`,
        event: { kind: "earnings", report },
      })),
    };
  });
}
