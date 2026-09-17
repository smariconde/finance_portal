import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildCompanyFactsJobPlan,
  createCompanyFactsJobExecutor,
  observeSourceSignals,
} from "@/modules/fundamentals/application/company-facts-backfill";
import { ingestCompanyFacts } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  createLiveCompanyFactsSource,
} from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildFixtureCompanyFactsText,
  buildFixtureFilerGraph,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_FILER_CIK,
  FIXTURE_FILER_ENTITY_ID,
  FIXTURE_HISTORY_FILE,
} from "@/modules/fundamentals/infrastructure/fixture-sec-filer";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createPostgresIngestionJobStore } from "@/server/db/postgres-ingestion-job-store";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const T0 = "2026-09-16T12:00:00.000Z";
const UNKNOWN_CIK = "0000000043";

const secEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === "sec-edgar",
)!;

/**
 * El backfill sobre PostgreSQL de punta a punta: lease, cursor, señal de la
 * fuente y publicación real, con las foreign keys de verdad entre items y
 * corridas.
 *
 * Los jobs de esta suite son de `sec-edgar`, y otras suites borran las corridas
 * de esa fuente: por eso la limpieza borra primero los jobs que las referencian.
 */
describe("PostgreSQL company facts backfill", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;
  let now = T0;
  let throttleSubmissions = false;

  const egress: EgressFetch = async ({ url }) => {
    if (throttleSubmissions && url === buildSubmissionsUrl(FIXTURE_FILER_CIK)) {
      throttleSubmissions = false;
      return {
        status: 429,
        body: new Uint8Array(),
        byteLength: 0,
        fetchedAt: now,
        // Más largo que la espera en línea: la corrida suelta la fuente.
        retryAfter: "900",
      };
    }

    const text =
      url === buildSubmissionsUrl(FIXTURE_FILER_CIK)
        ? JSON.stringify(buildFixtureSubmissions())
        : url === `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`
          ? JSON.stringify(buildFixtureSubmissionsHistory())
          : url === buildCompanyFactsUrl(FIXTURE_FILER_CIK)
            ? buildFixtureCompanyFactsText()
            : "";
    const body = new TextEncoder().encode(text);

    return {
      status: text === "" ? 404 : 200,
      body,
      byteLength: body.byteLength,
      fetchedAt: now,
    };
  };

  async function clean() {
    const jobIds = database
      .select({ jobId: schema.ingestionJobs.jobId })
      .from(schema.ingestionJobs)
      .where(eq(schema.ingestionJobs.sourceId, "sec-edgar"));

    await database
      .delete(schema.ingestionJobEvents)
      .where(inArray(schema.ingestionJobEvents.jobId, jobIds));
    await database
      .delete(schema.ingestionSourceLeases)
      .where(eq(schema.ingestionSourceLeases.sourceId, "sec-edgar"));
    await database
      .delete(schema.ingestionJobItems)
      .where(inArray(schema.ingestionJobItems.jobId, jobIds));
    await database
      .delete(schema.ingestionJobs)
      .where(eq(schema.ingestionJobs.sourceId, "sec-edgar"));
    await database
      .delete(schema.observations)
      .where(
        inArray(
          schema.observations.ingestionRunId,
          database
            .select({ runId: schema.ingestionRuns.runId })
            .from(schema.ingestionRuns)
            .where(eq(schema.ingestionRuns.sourceId, "sec-edgar")),
        ),
      );
    await database
      .delete(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.sourceId, "sec-edgar"));
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, "sec-edgar"));
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
    await createPostgresSourceRegistryRepository(database).upsert(secEntry);
  });

  beforeEach(async () => {
    now = T0;
    throttleSubmissions = false;
    await clean();
  });

  afterAll(async () => {
    if (database) {
      await clean();
    }
    await client?.end();
  });

  function dependencies() {
    const signals = observeSourceSignals(egress);
    const ingestion = {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      sourceDocuments: createPostgresSourceDocumentRepository(database),
      observations: createPostgresObservationRepository(database),
      identity: createGraphIdentityResolver(buildFixtureFilerGraph),
      source: createLiveCompanyFactsSource({ fetch: signals.fetch }),
      now: () => now,
      newId: () => randomUUID(),
    };

    return {
      store: createPostgresIngestionJobStore(database),
      execute: createCompanyFactsJobExecutor({
        ingest: (cik) =>
          ingestCompanyFacts({ cik, mode: "personal" }, ingestion),
        takeSignal: signals.take,
      }),
      now: () => now,
      sleep: async () => undefined,
      newLeaseToken: () => randomUUID(),
      startHeartbeat: () => () => undefined,
    };
  }

  it("frena ante un 429, retoma después de la espera y publica la historia", async () => {
    const deps = dependencies();
    const { job } = await deps.store.createJob(
      buildCompanyFactsJobPlan(
        [FIXTURE_FILER_CIK, UNKNOWN_CIK].map((cik) => ({
          cik,
          legalEntityId: randomUUID(),
          role: "index_member" as const,
          symbols: [],
          successorLegalEntityId: null,
        })),
      ),
      { now: T0 },
    );
    throttleSubmissions = true;

    const throttled = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      deps,
    );

    expect(throttled.stopReason).toBe("source_signal");
    expect(throttled.waitUntil).toBe("2026-09-16T12:15:00.000Z");
    const [waiting] = await deps.store.listItems({ jobId: job.jobId });
    expect(waiting).toMatchObject({
      status: "pending",
      attempts: 0,
      lastFailure: { code: "source_signal" },
    });
    const [failedRun] = await database
      .select()
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.runId, waiting!.ingestionRunId!));
    expect(failedRun?.status).toBe("failed");
    expect(await deps.store.getLease("sec-edgar")).toBeNull();

    now = "2026-09-16T12:10:00.000Z";
    const early = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      deps,
    );
    expect(early.stopReason).toBe("job_not_runnable");

    now = "2026-09-16T12:15:00.000Z";
    const resumed = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-b" },
      deps,
    );

    expect(resumed.stopReason).toBe("completed");
    const items = await deps.store.listItems({ jobId: job.jobId });
    expect(
      items.map((item) => [item.subjectKey, item.status, item.attempts]),
    ).toEqual([
      [FIXTURE_FILER_CIK, "completed", 1],
      [UNKNOWN_CIK, "failed", 1],
    ]);
    expect(items[1]?.lastFailure?.code).toBe("subject_rejected");

    const [publishedRun] = await database
      .select()
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.runId, items[0]!.ingestionRunId!));
    expect(publishedRun?.status).toBe("succeeded");

    const observations = await database
      .select({ subjectId: schema.observations.subjectId })
      .from(schema.observations)
      .where(eq(schema.observations.ingestionRunId, publishedRun!.runId));
    expect(observations.length).toBeGreaterThan(0);
    expect(new Set(observations.map((row) => row.subjectId))).toEqual(
      new Set([FIXTURE_FILER_ENTITY_ID]),
    );

    const events = await deps.store.listEvents({
      jobId: job.jobId,
      limit: 100,
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "job_created",
      "lease_acquired",
      "item_started",
      "item_deferred",
      "job_backoff",
      "lease_released",
      "lease_acquired",
      "item_started",
      "item_completed",
      "item_started",
      "item_failed",
      "job_completed",
      "lease_released",
    ]);
  });

  it("un intento repetido tras perder el checkpoint no duplica la publicación", async () => {
    const deps = dependencies();
    const { job } = await deps.store.createJob(
      buildCompanyFactsJobPlan([
        {
          cik: FIXTURE_FILER_CIK,
          legalEntityId: randomUUID(),
          role: "index_member",
          symbols: [],
          successorLegalEntityId: null,
        },
      ]),
      { now: T0 },
    );

    // Un proceso ingiere la empresa y muere antes de registrar el checkpoint.
    const dead = await deps.store.acquireLease({
      jobId: job.jobId,
      holder: "worker-dead",
      leaseToken: randomUUID(),
      now: T0,
      ttlMs: 60_000,
    });
    if (dead.status !== "acquired") {
      throw new Error("setup failed");
    }
    const started = await deps.store.startItem(dead.lease, {
      ordinal: 0,
      now: T0,
      ttlMs: 60_000,
    });
    if (started.status !== "ok") {
      throw new Error("setup failed");
    }
    const lost = await deps.execute(started.item, started.job);
    expect(lost.kind).toBe("ingested");

    now = "2026-09-16T13:00:00.000Z";
    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      deps,
    );

    expect(result.takenOver?.holder).toBe("worker-dead");
    expect(result.recovered).toHaveLength(1);
    expect(result.stopReason).toBe("completed");

    const runs = await database
      .select({ status: schema.ingestionRuns.status })
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, "sec-edgar"));
    // La repetición es una corrida `duplicate`: el contenido ya estaba publicado.
    expect(runs.map((run) => run.status).sort()).toEqual([
      "duplicate",
      "succeeded",
    ]);
  });
});
