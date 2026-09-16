import { randomUUID } from "node:crypto";

import { eq, inArray, like, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  at,
  describeIngestionJobStoreContract,
  planFor,
  uniqueSourceId,
} from "@/modules/ingestion/application/ingestion-job-store.contract";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import { decideItemAttempt } from "@/modules/ingestion/domain/ingestion-job";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { createPostgresIngestionJobStore } from "@/server/db/postgres-ingestion-job-store";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const RUN_SOURCE_ID = "fixture-jobs-runs";
const TTL = 60_000;

type PostgresErrorShape = { code?: string; constraint_name?: string };

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ??
      error) as PostgresErrorShape;
    expect(cause.constraint_name).toBe(constraintName);
    return;
  }

  throw new Error(`Expected ${constraintName} to reject the statement.`);
}

function connect(): Sql {
  return postgres(databaseTestUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
}

/**
 * Cada caso usa fuentes `fixture-jobs-*` y corridas bajo su propia fuente, así
 * que la limpieza es acotada: las otras suites borran corridas de `sec-edgar` y
 * de la demo, y una fila de item colgada de una de esas corridas les rompería el
 * borrado por la foreign key.
 */
async function cleanJobs(database: PostgresJsDatabase<typeof schema>) {
  const jobIds = database
    .select({ jobId: schema.ingestionJobs.jobId })
    .from(schema.ingestionJobs)
    .where(like(schema.ingestionJobs.sourceId, "fixture-jobs-%"));

  await database
    .delete(schema.ingestionJobEvents)
    .where(inArray(schema.ingestionJobEvents.jobId, jobIds));
  await database
    .delete(schema.ingestionSourceLeases)
    .where(like(schema.ingestionSourceLeases.sourceId, "fixture-jobs-%"));
  await database
    .delete(schema.ingestionJobItems)
    .where(inArray(schema.ingestionJobItems.jobId, jobIds));
  await database
    .delete(schema.ingestionJobs)
    .where(like(schema.ingestionJobs.sourceId, "fixture-jobs-%"));
  await database
    .delete(schema.ingestionRuns)
    .where(eq(schema.ingestionRuns.sourceId, RUN_SOURCE_ID));
}

let client: Sql;
let database: PostgresJsDatabase<typeof schema>;
const extraClients: Sql[] = [];

beforeAll(async () => {
  client = connect();
  database = drizzle(client, { schema });
  await cleanJobs(database);
});

afterAll(async () => {
  if (database) {
    await cleanJobs(database);
  }

  await Promise.all(extraClients.map((extra) => extra.end()));
  await client?.end();
});

async function createIngestionRun(): Promise<string> {
  const runId = randomUUID();

  await createPostgresIngestionRunRepository(database).append({
    runId,
    sourceId: RUN_SOURCE_ID,
    datasetId: "fixture.jobs",
    parserVersion: "fixture-1.0.0",
    idempotencyKey: computeContentHash({ runId }),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: null,
    selectionVersion: null,
    status: "failed",
    startedAt: at(0),
    finishedAt: at(0),
    counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
    contentHash: null,
    failure: { code: "provider_error", message: "fixture", retryable: true },
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: at(0),
  });

  return runId;
}

describeIngestionJobStoreContract("postgres", () => ({
  store: createPostgresIngestionJobStore(database),
  createIngestionRun,
}));

describe("PostgreSQL ingestion job store", () => {
  /** Un almacén por conexión: cada uno es otro proceso para la base. */
  function separateStores(count: number): IngestionJobStore[] {
    return Array.from({ length: count }, () => {
      const extra = connect();
      extraClients.push(extra);

      return createPostgresIngestionJobStore(drizzle(extra, { schema }));
    });
  }

  it("entre conexiones concurrentes, sólo una toma el lease de la fuente", async () => {
    const sourceId = uniqueSourceId();
    const stores = separateStores(8);
    const { job } = await stores[0]!.createJob(
      planFor(sourceId, ["0000000001", "0000000002"]),
      { now: at(0) },
    );

    const acquisitions = await Promise.all(
      stores.map((store, index) =>
        store.acquireLease({
          jobId: job.jobId,
          holder: `worker-${index}`,
          leaseToken: randomUUID(),
          now: at(1),
          ttlMs: TTL,
        }),
      ),
    );

    const acquired = acquisitions.filter(
      (result) => result.status === "acquired",
    );
    const busy = acquisitions.filter((result) => result.status === "busy");

    expect(acquired).toHaveLength(1);
    expect(busy).toHaveLength(7);
    expect(
      new Set(
        busy.map(
          (result) => result.status === "busy" && result.lease.leaseToken,
        ),
      ),
    ).toEqual(
      new Set([
        acquired[0]!.status === "acquired" && acquired[0]!.lease.leaseToken,
      ]),
    );
  });

  it("entre conexiones concurrentes, el mismo plan crea un solo job", async () => {
    const sourceId = uniqueSourceId();
    const stores = separateStores(6);

    const creations = await Promise.all(
      stores.map((store) =>
        store.createJob(planFor(sourceId, ["0000000001", "0000000002"]), {
          now: at(0),
        }),
      ),
    );

    expect(creations.filter((creation) => creation.created)).toHaveLength(1);
    expect(new Set(creations.map((creation) => creation.job.jobId)).size).toBe(
      1,
    );

    const [{ items }] = await database
      .select({ items: sql<number>`count(*)::int` })
      .from(schema.ingestionJobItems)
      .where(eq(schema.ingestionJobItems.jobId, creations[0]!.job.jobId));
    expect(items).toBe(2);
  });

  /**
   * Retiene el lock transaccional de la fuente desde otra conexión, para que
   * las operaciones siguientes queden esperando en el orden en que llegan.
   */
  async function holdSourceLock(sourceId: string) {
    const holder = connect();
    extraClients.push(holder);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const transaction = holder.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(20515::int4, hashtext(${sourceId}::text))`;
      locked();
      await released;
    });

    await isLocked;

    return {
      release: async () => {
        release();
        await transaction;
      },
    };
  }

  async function waitForAdvisoryWaiters(count: number) {
    for (let poll = 0; poll < 200; poll += 1) {
      const [row] = await client<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_locks
        where locktype = 'advisory' and classid = 20515 and objsubid = 2 and not granted`;

      if (row!.waiting >= count) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(`Expected ${count} advisory lock waiters.`);
  }

  it.each(["checkpoint", "toma"] as const)(
    "con el lock de la fuente en disputa, un checkpoint tardío y una toma nunca ganan los dos (%s primero)",
    async (first) => {
      const sourceId = uniqueSourceId();
      const [zombie, taker] = separateStores(2);
      // Dos items: si el checkpoint gana, el job sigue abierto y la toma choca
      // con un lease vivo en vez de con un job completado.
      const { job } = await zombie!.createJob(
        planFor(sourceId, ["0000000001", "0000000002"]),
        { now: at(0) },
      );
      const acquisition = await zombie!.acquireLease({
        jobId: job.jobId,
        holder: "worker-zombie",
        leaseToken: randomUUID(),
        now: at(0),
        ttlMs: TTL,
      });

      if (acquisition.status !== "acquired") {
        throw new Error("setup failed");
      }

      const handle = {
        sourceId,
        jobId: job.jobId,
        holder: acquisition.lease.holder,
        leaseToken: acquisition.lease.leaseToken,
      };
      await zombie!.startItem(handle, { ordinal: 0, now: at(1), ttlMs: TTL });
      const runId = await createIngestionRun();
      const late = at(TTL + 5);
      const checkpoint = () =>
        zombie!.finishItem(handle, {
          ordinal: 0,
          decision: decideItemAttempt(
            { kind: "ingested", ingestionRunId: runId },
            { attempts: 1, maxAttempts: 3, now: late },
          ),
          now: late,
          ttlMs: TTL,
        });
      const takeover = () =>
        taker!.acquireLease({
          jobId: job.jobId,
          holder: "worker-taker",
          leaseToken: randomUUID(),
          now: late,
          ttlMs: TTL,
        });

      const lock = await holdSourceLock(sourceId);
      let finishing: ReturnType<typeof checkpoint>;
      let taking: ReturnType<typeof takeover>;

      if (first === "checkpoint") {
        finishing = checkpoint();
        await waitForAdvisoryWaiters(1);
        taking = takeover();
        await waitForAdvisoryWaiters(2);
      } else {
        taking = takeover();
        await waitForAdvisoryWaiters(1);
        finishing = checkpoint();
        await waitForAdvisoryWaiters(2);
      }

      await lock.release();
      const [finished, taken] = await Promise.all([finishing, taking]);
      const [item] = await taker!.listItems({ jobId: job.jobId });

      if (first === "checkpoint") {
        // El checkpoint renovó el lease antes de la toma: la fuente sigue ocupada.
        expect(finished.status).toBe("ok");
        expect(taken.status).toBe("busy");
        expect(item?.status).toBe("completed");
      } else {
        // La toma cambió el token: el resultado del zombi no se escribe y el
        // intento vuelve a la cola para el nuevo dueño.
        expect(finished.status).toBe("lease_lost");
        expect(taken.status).toBe("acquired");
        expect(taken.status === "acquired" && taken.recovered).toHaveLength(1);
        expect(item).toMatchObject({ status: "pending", attempts: 1 });
      }
    },
  );

  it("las invariantes también las sostiene la base", async () => {
    const sourceId = uniqueSourceId();
    const store = createPostgresIngestionJobStore(database);
    const { job } = await store.createJob(planFor(sourceId, ["0000000001"]), {
      now: at(0),
    });

    await expectConstraintViolation(
      () =>
        database
          .update(schema.ingestionJobItems)
          .set({ status: "running" })
          .where(eq(schema.ingestionJobItems.jobId, job.jobId)),
      "ingestion_job_items_running_check",
    );
    await expectConstraintViolation(
      () =>
        database
          .update(schema.ingestionJobItems)
          .set({ status: "completed", finishedAt: new Date(at(1)) })
          .where(eq(schema.ingestionJobItems.jobId, job.jobId)),
      "ingestion_job_items_completed_run_check",
    );
    await expectConstraintViolation(
      () =>
        database
          .update(schema.ingestionJobs)
          .set({ status: "completed", finishedAt: new Date(at(1)) })
          .where(eq(schema.ingestionJobs.jobId, job.jobId)),
      "ingestion_jobs_completion_check",
    );
    await expectConstraintViolation(
      () =>
        database
          .update(schema.ingestionJobs)
          .set({ cursor: 1 })
          .where(eq(schema.ingestionJobs.jobId, job.jobId)),
      "ingestion_jobs_completion_check",
    );
    await expectConstraintViolation(
      () =>
        database.insert(schema.ingestionSourceLeases).values({
          sourceId,
          jobId: job.jobId,
          holder: "worker a",
          leaseToken: randomUUID(),
          acquiredAt: new Date(at(0)),
          heartbeatAt: new Date(at(0)),
          expiresAt: new Date(at(TTL)),
        }),
      "ingestion_source_leases_holder_check",
    );
    await expectConstraintViolation(
      () =>
        database.insert(schema.ingestionSourceLeases).values({
          sourceId,
          jobId: job.jobId,
          holder: "worker-a",
          leaseToken: randomUUID(),
          acquiredAt: new Date(at(0)),
          heartbeatAt: new Date(at(0)),
          expiresAt: new Date(at(0)),
        }),
      "ingestion_source_leases_timeline_check",
    );
  });

  it("un segundo job abierto con el mismo plan choca con el índice único", async () => {
    const sourceId = uniqueSourceId();
    const store = createPostgresIngestionJobStore(database);
    const { job } = await store.createJob(planFor(sourceId, ["0000000001"]), {
      now: at(0),
    });
    const [row] = await database
      .select()
      .from(schema.ingestionJobs)
      .where(eq(schema.ingestionJobs.jobId, job.jobId));

    await expectConstraintViolation(
      () =>
        database
          .insert(schema.ingestionJobs)
          .values({ ...row!, jobId: randomUUID(), status: "paused" }),
      "ingestion_jobs_active_plan_uidx",
    );
  });
});
