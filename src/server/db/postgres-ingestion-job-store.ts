import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  min,
  ne,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  IngestionJobNotFoundError,
  IngestionJobStateError,
  ingestionJobEventListQuerySchema,
  ingestionJobItemListQuerySchema,
  ingestionJobListQuerySchema,
  type IngestionJobStore,
} from "@/modules/ingestion/application/ingestion-job-store";
import {
  addMilliseconds,
  computeIngestionJobPlanHash,
  EMPTY_ITEM_COUNTS,
  ingestionJobEventSchema,
  ingestionJobItemSchema,
  ingestionJobPlanSchema,
  ingestionJobReasonSchema,
  ingestionJobSchema,
  ingestionLeaseSchema,
  isLeaseExpired,
  isTerminalJobStatus,
  OWNER_ACTOR,
  type IngestionJob,
  type IngestionJobItem,
  type IngestionLease,
  type IngestionLeaseHandle,
} from "@/modules/ingestion/domain/ingestion-job";
import {
  advanceJob,
  applyItemDecision,
  decisionEvents,
  draftEvent,
  isItemReady,
  isJobRunnable,
  recoverOrphanItem,
  reopenJob,
  requeueItemState,
  startItemAttempt,
  type IngestionJobEventDraft,
} from "@/modules/ingestion/domain/ingestion-job-transitions";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Almacén personal de jobs de ingesta (ADR 0015).
 *
 * Dos mecanismos con trabajos distintos:
 *
 * - el **lease** es una fila con vencimiento: la exclusión entre procesos que
 *   dura lo que dura una corrida, y sobrevive a una conexión que se cae;
 * - `pg_advisory_xact_lock` por fuente serializa cada transición corta. Todas
 *   toman ese único lock antes de leer, así que el orden de locks no puede
 *   producir un deadlock y ninguna lectura queda vieja antes de escribir.
 *
 * El lock es de transacción y no de sesión: con un pooler en modo transacción
 * (ADR 0001) un lock de sesión quedaría en una conexión que otro cliente reusa.
 * Una colisión del hash entre dos fuentes sólo serializa de más; nunca da un
 * resultado incorrecto.
 *
 * Los instantes vienen del reloj inyectado; ninguna sentencia usa `now()`.
 */
const SOURCE_LOCK_NAMESPACE = 20_515;
/** Un plan grande se inserta por partes: PostgreSQL admite 65.535 parámetros. */
const ITEM_INSERT_CHUNK = 1000;

async function lockSource(tx: Transaction, sourceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SOURCE_LOCK_NAMESPACE}::int4, hashtext(${sourceId}::text))`,
  );
}

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();
const dateOrNull = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

type JobRow = typeof schema.ingestionJobs.$inferSelect;
type ItemRow = typeof schema.ingestionJobItems.$inferSelect;
type LeaseRow = typeof schema.ingestionSourceLeases.$inferSelect;
type EventRow = typeof schema.ingestionJobEvents.$inferSelect;

function toJob(row: JobRow): IngestionJob {
  return ingestionJobSchema.parse({
    jobId: row.jobId,
    kind: row.jobKind,
    sourceId: row.sourceId,
    datasetId: row.datasetId,
    parserVersion: row.parserVersion,
    selectionVersion: row.selectionVersion,
    planHash: row.planHash,
    itemCount: row.itemCount,
    maxAttempts: row.maxAttempts,
    status: row.status,
    cursor: row.cursor,
    notBefore: isoOrNull(row.notBefore),
    statusReason: row.statusReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    finishedAt: isoOrNull(row.finishedAt),
  });
}

function toJobRow(job: IngestionJob): typeof schema.ingestionJobs.$inferInsert {
  return {
    jobId: job.jobId,
    jobKind: job.kind,
    sourceId: job.sourceId,
    datasetId: job.datasetId,
    parserVersion: job.parserVersion,
    selectionVersion: job.selectionVersion,
    planHash: job.planHash,
    itemCount: job.itemCount,
    maxAttempts: job.maxAttempts,
    status: job.status,
    cursor: job.cursor,
    notBefore: dateOrNull(job.notBefore),
    statusReason: job.statusReason,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    finishedAt: dateOrNull(job.finishedAt),
  };
}

function toItem(row: ItemRow): IngestionJobItem {
  return ingestionJobItemSchema.parse({
    jobId: row.jobId,
    ordinal: row.ordinal,
    subjectKey: row.subjectKey,
    status: row.status,
    attempts: row.attempts,
    notBefore: isoOrNull(row.notBefore),
    leaseToken: row.leaseToken,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    ingestionRunId: row.ingestionRunId,
    lastFailure:
      row.failureCode === null
        ? null
        : {
            code: row.failureCode,
            message: row.failureMessage,
            retryable: row.failureRetryable,
          },
    updatedAt: iso(row.updatedAt),
  });
}

function toItemRow(
  item: IngestionJobItem,
): typeof schema.ingestionJobItems.$inferInsert {
  return {
    jobId: item.jobId,
    ordinal: item.ordinal,
    subjectKey: item.subjectKey,
    status: item.status,
    attempts: item.attempts,
    notBefore: dateOrNull(item.notBefore),
    leaseToken: item.leaseToken,
    startedAt: dateOrNull(item.startedAt),
    finishedAt: dateOrNull(item.finishedAt),
    ingestionRunId: item.ingestionRunId,
    failureCode: item.lastFailure?.code ?? null,
    failureMessage: item.lastFailure?.message ?? null,
    failureRetryable: item.lastFailure?.retryable ?? null,
    updatedAt: new Date(item.updatedAt),
  };
}

function toLease(row: LeaseRow): IngestionLease {
  return ingestionLeaseSchema.parse({
    sourceId: row.sourceId,
    jobId: row.jobId,
    holder: row.holder,
    leaseToken: row.leaseToken,
    acquiredAt: iso(row.acquiredAt),
    heartbeatAt: iso(row.heartbeatAt),
    expiresAt: iso(row.expiresAt),
  });
}

function toLeaseRow(
  lease: IngestionLease,
): typeof schema.ingestionSourceLeases.$inferInsert {
  return {
    sourceId: lease.sourceId,
    jobId: lease.jobId,
    holder: lease.holder,
    leaseToken: lease.leaseToken,
    acquiredAt: new Date(lease.acquiredAt),
    heartbeatAt: new Date(lease.heartbeatAt),
    expiresAt: new Date(lease.expiresAt),
  };
}

function toEvent(row: EventRow) {
  return ingestionJobEventSchema.parse({
    sequence: row.eventSequence,
    jobId: row.jobId,
    ordinal: row.ordinal,
    eventType: row.eventType,
    actor: row.actor,
    leaseToken: row.leaseToken,
    occurredAt: iso(row.occurredAt),
    detail: row.detail,
  });
}

async function appendEvents(
  tx: Transaction,
  drafts: readonly IngestionJobEventDraft[],
): Promise<void> {
  if (drafts.length === 0) {
    return;
  }

  await tx.insert(schema.ingestionJobEvents).values(
    drafts.map((draft) => ({
      jobId: draft.jobId,
      ordinal: draft.ordinal,
      eventType: draft.eventType,
      actor: draft.actor,
      leaseToken: draft.leaseToken,
      occurredAt: new Date(draft.occurredAt),
      detail: draft.detail,
    })),
  );
}

async function findJob(
  executor: Database | Transaction,
  jobId: string,
): Promise<IngestionJob | null> {
  const [row] = await executor
    .select()
    .from(schema.ingestionJobs)
    .where(eq(schema.ingestionJobs.jobId, jobId))
    .limit(1);

  return row ? toJob(row) : null;
}

/**
 * Toma el lock de la fuente del job y lo relee. La fuente de un job no cambia,
 * así que leerla antes del lock no abre una carrera.
 */
async function lockJob(tx: Transaction, jobId: string): Promise<IngestionJob> {
  const before = await findJob(tx, parseJobId(jobId));

  if (before === null) {
    throw new IngestionJobNotFoundError(jobId);
  }

  await lockSource(tx, before.sourceId);

  return (await findJob(tx, jobId))!;
}

async function findLease(
  tx: Transaction,
  sourceId: string,
): Promise<IngestionLease | null> {
  const [row] = await tx
    .select()
    .from(schema.ingestionSourceLeases)
    .where(eq(schema.ingestionSourceLeases.sourceId, sourceId))
    .limit(1);

  return row ? toLease(row) : null;
}

function holds(current: IngestionLease | null, lease: IngestionLeaseHandle) {
  return (
    current !== null &&
    current.leaseToken === lease.leaseToken &&
    current.jobId === lease.jobId
  );
}

async function renewLease(
  tx: Transaction,
  current: IngestionLease,
  now: string,
  ttlMs: number,
): Promise<IngestionLease> {
  const renewed = ingestionLeaseSchema.parse({
    ...current,
    heartbeatAt: now,
    expiresAt: addMilliseconds(now, ttlMs),
  });

  await tx
    .update(schema.ingestionSourceLeases)
    .set(toLeaseRow(renewed))
    .where(eq(schema.ingestionSourceLeases.sourceId, current.sourceId));

  return renewed;
}

async function findItem(
  tx: Transaction,
  jobId: string,
  ordinal: number,
): Promise<IngestionJobItem | null> {
  const [row] = await tx
    .select()
    .from(schema.ingestionJobItems)
    .where(
      and(
        eq(schema.ingestionJobItems.jobId, jobId),
        eq(schema.ingestionJobItems.ordinal, ordinal),
      ),
    )
    .limit(1);

  return row ? toItem(row) : null;
}

async function writeItem(tx: Transaction, item: IngestionJobItem) {
  await tx
    .update(schema.ingestionJobItems)
    .set(toItemRow(item))
    .where(
      and(
        eq(schema.ingestionJobItems.jobId, item.jobId),
        eq(schema.ingestionJobItems.ordinal, item.ordinal),
      ),
    );
}

async function writeJob(tx: Transaction, job: IngestionJob) {
  await tx
    .update(schema.ingestionJobs)
    .set(toJobRow(job))
    .where(eq(schema.ingestionJobs.jobId, job.jobId));
}

/** `computeJobCursor` en SQL: el primer ordinal no terminal. */
async function computeCursor(tx: Transaction, job: IngestionJob) {
  const [row] = await tx
    .select({ cursor: min(schema.ingestionJobItems.ordinal) })
    .from(schema.ingestionJobItems)
    .where(
      and(
        eq(schema.ingestionJobItems.jobId, job.jobId),
        inArray(schema.ingestionJobItems.status, ["pending", "running"]),
      ),
    );

  return row?.cursor ?? job.itemCount;
}

/**
 * Todo item `running` de la fuente con otro token que el lease vigente. Con el
 * lock de la fuente tomado, ese es exactamente el conjunto de intentos cuyo
 * proceso ya no puede escribir su resultado.
 */
async function recoverOrphans(
  tx: Transaction,
  sourceId: string,
  context: { actor: string; now: string },
): Promise<IngestionJobItem[]> {
  const currentToken = (await findLease(tx, sourceId))?.leaseToken ?? null;
  const rows = await tx
    .select({ item: schema.ingestionJobItems })
    .from(schema.ingestionJobItems)
    .innerJoin(
      schema.ingestionJobs,
      eq(schema.ingestionJobItems.jobId, schema.ingestionJobs.jobId),
    )
    .where(
      and(
        eq(schema.ingestionJobs.sourceId, sourceId),
        eq(schema.ingestionJobItems.status, "running"),
        currentToken === null
          ? undefined
          : ne(schema.ingestionJobItems.leaseToken, currentToken),
      ),
    )
    .orderBy(
      asc(schema.ingestionJobItems.jobId),
      asc(schema.ingestionJobItems.ordinal),
    );

  const recovered: IngestionJobItem[] = [];
  const touchedJobs = new Set<string>();

  for (const { item: row } of rows) {
    const orphan = toItem(row);
    const job = (await findJob(tx, orphan.jobId))!;
    const result = recoverOrphanItem(orphan, job.maxAttempts, {
      actor: context.actor,
      leaseToken: currentToken,
      now: context.now,
    });

    await writeItem(tx, result.item);
    await appendEvents(tx, result.events);
    recovered.push(result.item);
    touchedJobs.add(orphan.jobId);
  }

  for (const jobId of touchedJobs) {
    const job = (await findJob(tx, jobId))!;
    const advanced = advanceJob(job, await computeCursor(tx, job), {
      now: context.now,
      actor: context.actor,
      leaseToken: currentToken,
    });

    await writeJob(tx, advanced.job);
    await appendEvents(tx, advanced.events);
  }

  return recovered;
}

export function createPostgresIngestionJobStore(
  database: Database,
  options: { readonly newId?: () => string } = {},
): IngestionJobStore {
  const newId = options.newId ?? randomUUID;

  return {
    storage: "personal-postgres",

    async createJob(planInput, { now }) {
      const plan = ingestionJobPlanSchema.parse(planInput);
      const planHash = computeIngestionJobPlanHash(plan);

      return database.transaction(async (tx) => {
        await lockSource(tx, plan.sourceId);

        const [existing] = await tx
          .select()
          .from(schema.ingestionJobs)
          .where(
            and(
              eq(schema.ingestionJobs.planHash, planHash),
              inArray(schema.ingestionJobs.status, ["open", "paused"]),
            ),
          )
          .limit(1);

        if (existing) {
          return { created: false, job: toJob(existing) };
        }

        const job = ingestionJobSchema.parse({
          jobId: newId(),
          kind: plan.kind,
          sourceId: plan.sourceId,
          datasetId: plan.datasetId,
          parserVersion: plan.parserVersion,
          selectionVersion: plan.selectionVersion,
          planHash,
          itemCount: plan.subjects.length,
          maxAttempts: plan.maxAttempts,
          status: "open",
          cursor: 0,
          notBefore: null,
          statusReason: null,
          createdAt: now,
          updatedAt: now,
          finishedAt: null,
        });

        await tx.insert(schema.ingestionJobs).values(toJobRow(job));

        for (
          let start = 0;
          start < plan.subjects.length;
          start += ITEM_INSERT_CHUNK
        ) {
          await tx.insert(schema.ingestionJobItems).values(
            plan.subjects
              .slice(start, start + ITEM_INSERT_CHUNK)
              .map((subjectKey, offset) =>
                toItemRow(
                  ingestionJobItemSchema.parse({
                    jobId: job.jobId,
                    ordinal: start + offset,
                    subjectKey,
                    status: "pending",
                    attempts: 0,
                    notBefore: null,
                    leaseToken: null,
                    startedAt: null,
                    finishedAt: null,
                    ingestionRunId: null,
                    lastFailure: null,
                    updatedAt: now,
                  }),
                ),
              ),
          );
        }

        await appendEvents(tx, [
          draftEvent({
            jobId: job.jobId,
            eventType: "job_created",
            actor: OWNER_ACTOR,
            occurredAt: now,
            detail: { planHash, itemCount: job.itemCount },
          }),
        ]);

        return { created: true, job };
      });
    },

    async getJob(jobId) {
      return findJob(database, parseJobId(jobId));
    },

    async listJobs(query) {
      const { sourceId, statuses, limit } =
        ingestionJobListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.ingestionJobs)
        .where(
          and(
            sourceId === undefined
              ? undefined
              : eq(schema.ingestionJobs.sourceId, sourceId),
            statuses === undefined
              ? undefined
              : inArray(schema.ingestionJobs.status, statuses),
          ),
        )
        .orderBy(desc(schema.ingestionJobs.createdAt))
        .limit(limit);

      return rows.map(toJob);
    },

    async listItems(query) {
      const { jobId, statuses, afterOrdinal, limit } =
        ingestionJobItemListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.ingestionJobItems)
        .where(
          and(
            eq(schema.ingestionJobItems.jobId, jobId),
            gt(schema.ingestionJobItems.ordinal, afterOrdinal),
            statuses === undefined
              ? undefined
              : inArray(schema.ingestionJobItems.status, statuses),
          ),
        )
        .orderBy(asc(schema.ingestionJobItems.ordinal))
        .limit(limit);

      return rows.map(toItem);
    },

    async countItems(jobId) {
      const rows = await database
        .select({
          status: schema.ingestionJobItems.status,
          total: count(),
        })
        .from(schema.ingestionJobItems)
        .where(eq(schema.ingestionJobItems.jobId, parseJobId(jobId)))
        .groupBy(schema.ingestionJobItems.status);
      const counts = { ...EMPTY_ITEM_COUNTS };

      for (const row of rows) {
        counts[row.status] = row.total;
      }

      return counts;
    },

    async listEvents(query) {
      const { jobId, limit } = ingestionJobEventListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.ingestionJobEvents)
        .where(eq(schema.ingestionJobEvents.jobId, jobId))
        .orderBy(desc(schema.ingestionJobEvents.eventSequence))
        .limit(limit);

      return rows.reverse().map(toEvent);
    },

    async getLease(sourceId) {
      const [row] = await database
        .select()
        .from(schema.ingestionSourceLeases)
        .where(eq(schema.ingestionSourceLeases.sourceId, sourceId))
        .limit(1);

      return row ? toLease(row) : null;
    },

    async peekNext(jobId) {
      const job = await findJob(database, parseJobId(jobId));

      if (job === null) {
        throw new IngestionJobNotFoundError(jobId);
      }

      if (isTerminalJobStatus(job.status)) {
        return { job, item: null };
      }

      const [row] = await database
        .select()
        .from(schema.ingestionJobItems)
        .where(
          and(
            eq(schema.ingestionJobItems.jobId, job.jobId),
            eq(schema.ingestionJobItems.ordinal, job.cursor),
          ),
        )
        .limit(1);

      return { job, item: row ? toItem(row) : null };
    },

    async acquireLease({ jobId, holder, leaseToken, now, ttlMs }) {
      return database.transaction(async (tx) => {
        const job = await lockJob(tx, jobId);

        if (!isJobRunnable(job, now)) {
          return { status: "job_not_runnable", job } as const;
        }

        const previous = await findLease(tx, job.sourceId);

        if (previous !== null && !isLeaseExpired(previous, now)) {
          return { status: "busy", lease: previous } as const;
        }

        const lease = ingestionLeaseSchema.parse({
          sourceId: job.sourceId,
          jobId,
          holder,
          leaseToken,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: addMilliseconds(now, ttlMs),
        });

        if (previous === null) {
          await tx
            .insert(schema.ingestionSourceLeases)
            .values(toLeaseRow(lease));
        } else {
          await tx
            .update(schema.ingestionSourceLeases)
            .set(toLeaseRow(lease))
            .where(eq(schema.ingestionSourceLeases.sourceId, job.sourceId));
        }

        await appendEvents(tx, [
          draftEvent({
            jobId,
            eventType:
              previous === null ? "lease_acquired" : "lease_taken_over",
            actor: holder,
            leaseToken,
            occurredAt: now,
            detail:
              previous === null
                ? { sourceId: job.sourceId }
                : {
                    sourceId: job.sourceId,
                    previousJobId: previous.jobId,
                    previousHolder: previous.holder,
                    previousLeaseToken: previous.leaseToken,
                    previousExpiresAt: previous.expiresAt,
                  },
          }),
        ]);

        const recovered = await recoverOrphans(tx, job.sourceId, {
          actor: holder,
          now,
        });

        return {
          status: "acquired",
          lease,
          takenOver: previous,
          recovered,
          job: (await findJob(tx, jobId))!,
        } as const;
      });
    },

    async heartbeat(lease, { now, ttlMs }) {
      return database.transaction(async (tx) => {
        await lockSource(tx, lease.sourceId);
        const current = await findLease(tx, lease.sourceId);

        if (!holds(current, lease)) {
          return null;
        }

        return renewLease(tx, current!, now, ttlMs);
      });
    },

    async releaseLease(lease, { now }) {
      return database.transaction(async (tx) => {
        await lockSource(tx, lease.sourceId);
        const current = await findLease(tx, lease.sourceId);

        if (!holds(current, lease)) {
          return false;
        }

        await tx
          .delete(schema.ingestionSourceLeases)
          .where(eq(schema.ingestionSourceLeases.sourceId, lease.sourceId));
        await appendEvents(tx, [
          draftEvent({
            jobId: lease.jobId,
            eventType: "lease_released",
            actor: lease.holder,
            leaseToken: lease.leaseToken,
            occurredAt: now,
            detail: { sourceId: lease.sourceId },
          }),
        ]);

        return true;
      });
    },

    async startItem(lease, { ordinal, now, ttlMs }) {
      return database.transaction(async (tx) => {
        await lockSource(tx, lease.sourceId);
        const current = await findLease(tx, lease.sourceId);

        if (!holds(current, lease)) {
          return { status: "lease_lost" } as const;
        }

        const job = (await findJob(tx, lease.jobId))!;

        if (!isJobRunnable(job, now)) {
          return { status: "job_not_runnable", job } as const;
        }

        const item = await findItem(tx, job.jobId, ordinal);

        if (item === null) {
          throw new IngestionJobStateError(
            "item_not_found",
            `Item ${ordinal} does not exist.`,
          );
        }

        if (ordinal !== job.cursor) {
          throw new IngestionJobStateError(
            "item_not_at_cursor",
            `Item ${ordinal} is not the cursor item (${job.cursor}).`,
          );
        }

        if (!isItemReady(item, now)) {
          throw new IngestionJobStateError(
            "item_not_ready",
            `Item ${ordinal} is not ready to start.`,
          );
        }

        const started = startItemAttempt(item, lease.leaseToken, now);
        await writeItem(tx, started);
        await renewLease(tx, current!, now, ttlMs);
        await appendEvents(tx, [
          draftEvent({
            jobId: job.jobId,
            ordinal,
            eventType: "item_started",
            actor: lease.holder,
            leaseToken: lease.leaseToken,
            occurredAt: now,
            detail: {
              attempt: started.attempts,
              subjectKey: started.subjectKey,
            },
          }),
        ]);

        return { status: "ok", item: started, job } as const;
      });
    },

    async finishItem(lease, { ordinal, decision, now, ttlMs }) {
      return database.transaction(async (tx) => {
        await lockSource(tx, lease.sourceId);
        const current = await findLease(tx, lease.sourceId);
        const item = await findItem(tx, lease.jobId, ordinal);

        if (
          !holds(current, lease) ||
          item === null ||
          item.status !== "running" ||
          item.leaseToken !== lease.leaseToken
        ) {
          return { status: "lease_lost" } as const;
        }

        const finished = applyItemDecision(item, decision, now);
        await writeItem(tx, finished);

        const job = (await findJob(tx, lease.jobId))!;
        const advanced = advanceJob(job, await computeCursor(tx, job), {
          now,
          actor: lease.holder,
          leaseToken: lease.leaseToken,
          jobNotBefore:
            decision.kind === "defer" ? decision.jobNotBefore : null,
        });

        await writeJob(tx, advanced.job);
        await renewLease(tx, current!, now, ttlMs);
        await appendEvents(tx, [
          ...decisionEvents(item, decision, {
            actor: lease.holder,
            leaseToken: lease.leaseToken,
            now,
          }),
          ...advanced.events,
        ]);

        return { status: "ok", item: finished, job: advanced.job } as const;
      });
    },

    async pauseJob(jobId, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);

      return database.transaction(async (tx) => {
        const job = await lockJob(tx, jobId);

        if (job.status !== "open") {
          throw new IngestionJobStateError(
            "job_terminal",
            `Job ${jobId} is ${job.status} and cannot be paused.`,
          );
        }

        const paused = ingestionJobSchema.parse({
          ...job,
          status: "paused",
          statusReason,
          updatedAt: now,
        });

        await writeJob(tx, paused);
        await appendEvents(tx, [
          draftEvent({
            jobId,
            eventType: "job_paused",
            actor: OWNER_ACTOR,
            occurredAt: now,
            detail: { reason: statusReason },
          }),
        ]);

        return paused;
      });
    },

    async resumeJob(jobId, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);

      return database.transaction(async (tx) => {
        const job = await lockJob(tx, jobId);

        if (!(
          job.status === "paused" ||
          (job.status === "open" && job.notBefore !== null)
        )) {
          throw new IngestionJobStateError(
            "job_not_paused",
            `Job ${jobId} is ${job.status} without a backoff; there is nothing to resume.`,
          );
        }

        const resumed = ingestionJobSchema.parse({
          ...job,
          status: "open",
          notBefore: null,
          statusReason,
          updatedAt: now,
        });

        await writeJob(tx, resumed);
        await appendEvents(tx, [
          draftEvent({
            jobId,
            eventType: "job_resumed",
            actor: OWNER_ACTOR,
            occurredAt: now,
            detail: {
              reason: statusReason,
              previousStatus: job.status,
              previousNotBefore: job.notBefore,
            },
          }),
        ]);

        return resumed;
      });
    },

    async cancelJob(jobId, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);

      return database.transaction(async (tx) => {
        const job = await lockJob(tx, jobId);

        if (isTerminalJobStatus(job.status)) {
          throw new IngestionJobStateError(
            "job_terminal",
            `Job ${jobId} is already ${job.status}.`,
          );
        }

        if ((await findLease(tx, job.sourceId))?.jobId === jobId) {
          throw new IngestionJobStateError(
            "job_leased",
            `Job ${jobId} holds its source lease; pause it or release the lease first.`,
          );
        }

        await recoverOrphans(tx, job.sourceId, { actor: OWNER_ACTOR, now });
        const cancelled = ingestionJobSchema.parse({
          ...(await findJob(tx, jobId))!,
          status: "cancelled",
          statusReason,
          notBefore: null,
          finishedAt: now,
          updatedAt: now,
        });

        await writeJob(tx, cancelled);
        await appendEvents(tx, [
          draftEvent({
            jobId,
            eventType: "job_cancelled",
            actor: OWNER_ACTOR,
            occurredAt: now,
            detail: { reason: statusReason, cursor: cancelled.cursor },
          }),
        ]);

        return cancelled;
      });
    },

    async requeueItem(jobId, ordinal, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);

      return database.transaction(async (tx) => {
        const job = await lockJob(tx, jobId);

        if (job.status === "cancelled") {
          throw new IngestionJobStateError(
            "job_terminal",
            `Job ${jobId} is cancelled.`,
          );
        }

        const item = await findItem(tx, jobId, ordinal);

        if (item === null) {
          throw new IngestionJobStateError(
            "item_not_found",
            `Item ${ordinal} does not exist.`,
          );
        }

        if (item.status !== "failed" && item.status !== "poisoned") {
          throw new IngestionJobStateError(
            "item_not_requeueable",
            `Item ${ordinal} is ${item.status}; only failed or poisoned items are requeued.`,
          );
        }

        const requeued = requeueItemState(item, now);
        await writeItem(tx, requeued);
        const reopened = reopenJob(job, await computeCursor(tx, job), now);
        await writeJob(tx, reopened);
        await appendEvents(tx, [
          draftEvent({
            jobId,
            ordinal,
            eventType: "item_requeued",
            actor: OWNER_ACTOR,
            occurredAt: now,
            detail: {
              reason: statusReason,
              previousStatus: item.status,
              previousAttempts: item.attempts,
            },
          }),
          ...(job.status === "completed"
            ? [
                draftEvent({
                  jobId,
                  eventType: "job_reopened",
                  actor: OWNER_ACTOR,
                  occurredAt: now,
                  detail: { reason: statusReason },
                }),
              ]
            : []),
        ]);

        return { item: requeued, job: reopened };
      });
    },

    async forceReleaseLease(sourceId, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);

      return database.transaction(async (tx) => {
        await lockSource(tx, sourceId);
        const released = await findLease(tx, sourceId);

        if (released !== null) {
          await tx
            .delete(schema.ingestionSourceLeases)
            .where(eq(schema.ingestionSourceLeases.sourceId, sourceId));
          await appendEvents(tx, [
            draftEvent({
              jobId: released.jobId,
              eventType: "lease_force_released",
              actor: OWNER_ACTOR,
              leaseToken: released.leaseToken,
              occurredAt: now,
              detail: {
                reason: statusReason,
                sourceId,
                holder: released.holder,
                expiresAt: released.expiresAt,
              },
            }),
          ]);
        }

        const recovered = await recoverOrphans(tx, sourceId, {
          actor: OWNER_ACTOR,
          now,
        });

        return { released, recovered };
      });
    },
  };
}

/** Un ID mal formado se rechaza antes de llegar a la consulta. */
function parseJobId(jobId: string): string {
  return ingestionJobSchema.shape.jobId.parse(jobId);
}
