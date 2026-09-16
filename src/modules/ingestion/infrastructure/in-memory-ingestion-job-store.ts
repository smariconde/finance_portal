import {
  IngestionJobNotFoundError,
  IngestionJobStateError,
  ingestionJobEventListQuerySchema,
  ingestionJobItemListQuerySchema,
  ingestionJobListQuerySchema,
  type FencedResult,
  type IngestionJobStore,
  type ItemTransition,
} from "@/modules/ingestion/application/ingestion-job-store";
import {
  addMilliseconds,
  computeIngestionJobPlanHash,
  computeJobCursor,
  EMPTY_ITEM_COUNTS,
  ingestionJobItemSchema,
  ingestionJobPlanSchema,
  ingestionJobReasonSchema,
  ingestionJobSchema,
  ingestionLeaseSchema,
  isLeaseExpired,
  isTerminalJobStatus,
  OWNER_ACTOR,
  type IngestionJob,
  type IngestionJobEvent,
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

/**
 * Doble de test del almacén de jobs. No es un modo de ejecución: ninguna raíz de
 * composición lo construye (ADR 0004).
 *
 * Cada operación corre entera sin ceder el event loop, que es su equivalente del
 * lock por fuente de PostgreSQL: dos workers del mismo proceso ven las mismas
 * carreras que dos procesos contra la base, salvo el orden de llegada.
 */
export function createInMemoryIngestionJobStore(options: {
  readonly newId: () => string;
}): IngestionJobStore & {
  /** Estado completo, para afirmar invariantes sin pasar por el puerto. */
  readonly snapshot: () => {
    readonly jobs: readonly IngestionJob[];
    readonly items: readonly IngestionJobItem[];
    readonly leases: readonly IngestionLease[];
  };
} {
  const jobs = new Map<string, IngestionJob>();
  const items = new Map<string, IngestionJobItem[]>();
  const leases = new Map<string, IngestionLease>();
  const events: IngestionJobEvent[] = [];
  let sequence = 0;

  const append = (drafts: readonly IngestionJobEventDraft[]) => {
    for (const draft of drafts) {
      sequence += 1;
      events.push({ ...draft, sequence });
    }
  };

  const requireJob = (jobId: string): IngestionJob => {
    const job = jobs.get(jobId);

    if (!job) {
      throw new IngestionJobNotFoundError(jobId);
    }

    return job;
  };

  const itemsOf = (jobId: string): IngestionJobItem[] => items.get(jobId) ?? [];

  const cursorOf = (job: IngestionJob): number =>
    computeJobCursor(itemsOf(job.jobId), job.itemCount);

  const replaceItem = (item: IngestionJobItem) => {
    const list = itemsOf(item.jobId);
    list[item.ordinal] = ingestionJobItemSchema.parse(item);
  };

  const holdsLease = (lease: IngestionLeaseHandle): boolean => {
    const current = leases.get(lease.sourceId);

    return (
      current !== undefined &&
      current.leaseToken === lease.leaseToken &&
      current.jobId === lease.jobId
    );
  };

  const renew = (lease: IngestionLeaseHandle, now: string, ttlMs: number) => {
    const current = leases.get(lease.sourceId)!;
    leases.set(
      lease.sourceId,
      ingestionLeaseSchema.parse({
        ...current,
        heartbeatAt: now,
        expiresAt: addMilliseconds(now, ttlMs),
      }),
    );
  };

  /** Todo item `running` de la fuente con otro token que el lease vigente. */
  const recoverOrphans = (
    sourceId: string,
    context: { actor: string; now: string },
  ): IngestionJobItem[] => {
    const currentToken = leases.get(sourceId)?.leaseToken ?? null;
    const recovered: IngestionJobItem[] = [];

    for (const job of jobs.values()) {
      if (job.sourceId !== sourceId) {
        continue;
      }

      const orphans = itemsOf(job.jobId).filter(
        (item) => item.status === "running" && item.leaseToken !== currentToken,
      );

      if (orphans.length === 0) {
        continue;
      }

      for (const orphan of orphans) {
        const result = recoverOrphanItem(orphan, job.maxAttempts, {
          actor: context.actor,
          leaseToken: currentToken,
          now: context.now,
        });
        replaceItem(result.item);
        append(result.events);
        recovered.push(result.item);
      }

      const advanced = advanceJob(job, cursorOf(job), {
        now: context.now,
        actor: context.actor,
        leaseToken: currentToken,
      });
      jobs.set(job.jobId, advanced.job);
      append(advanced.events);
    }

    return recovered;
  };

  return {
    storage: "in-memory-fixture",

    async createJob(planInput, { now }) {
      const plan = ingestionJobPlanSchema.parse(planInput);
      const planHash = computeIngestionJobPlanHash(plan);
      const existing = [...jobs.values()].find(
        (job) => job.planHash === planHash && !isTerminalJobStatus(job.status),
      );

      if (existing) {
        return { created: false, job: existing };
      }

      const job = ingestionJobSchema.parse({
        jobId: options.newId(),
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

      jobs.set(job.jobId, job);
      items.set(
        job.jobId,
        plan.subjects.map((subjectKey, ordinal) =>
          ingestionJobItemSchema.parse({
            jobId: job.jobId,
            ordinal,
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
      );
      append([
        draftEvent({
          jobId: job.jobId,
          eventType: "job_created",
          actor: OWNER_ACTOR,
          occurredAt: now,
          detail: { planHash, itemCount: job.itemCount },
        }),
      ]);

      return { created: true, job };
    },

    async getJob(jobId) {
      return jobs.get(jobId) ?? null;
    },

    async listJobs(query) {
      const { sourceId, statuses, limit } =
        ingestionJobListQuerySchema.parse(query);

      return [...jobs.values()]
        .filter(
          (job) =>
            (sourceId === undefined || job.sourceId === sourceId) &&
            (statuses === undefined || statuses.includes(job.status)),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },

    async listItems(query) {
      const { jobId, statuses, afterOrdinal, limit } =
        ingestionJobItemListQuerySchema.parse(query);

      return itemsOf(jobId)
        .filter(
          (item) =>
            item.ordinal > afterOrdinal &&
            (statuses === undefined || statuses.includes(item.status)),
        )
        .slice(0, limit);
    },

    async countItems(jobId) {
      const counts = { ...EMPTY_ITEM_COUNTS };

      for (const item of itemsOf(jobId)) {
        counts[item.status] += 1;
      }

      return counts;
    },

    async listEvents(query) {
      const { jobId, limit } = ingestionJobEventListQuerySchema.parse(query);

      return events.filter((event) => event.jobId === jobId).slice(-limit);
    },

    async getLease(sourceId) {
      return leases.get(sourceId) ?? null;
    },

    async peekNext(jobId) {
      const job = requireJob(jobId);

      return {
        job,
        item: isTerminalJobStatus(job.status)
          ? null
          : (itemsOf(jobId)[job.cursor] ?? null),
      };
    },

    async acquireLease({ jobId, holder, leaseToken, now, ttlMs }) {
      const job = requireJob(jobId);

      if (!isJobRunnable(job, now)) {
        return { status: "job_not_runnable", job };
      }

      const previous = leases.get(job.sourceId) ?? null;

      if (previous !== null && !isLeaseExpired(previous, now)) {
        return { status: "busy", lease: previous };
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
      leases.set(job.sourceId, lease);
      append([
        draftEvent({
          jobId,
          eventType: previous === null ? "lease_acquired" : "lease_taken_over",
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
      const recovered = recoverOrphans(job.sourceId, { actor: holder, now });

      return {
        status: "acquired",
        lease,
        takenOver: previous,
        recovered,
        job: requireJob(jobId),
      };
    },

    async heartbeat(lease, { now, ttlMs }) {
      if (!holdsLease(lease)) {
        return null;
      }

      renew(lease, now, ttlMs);

      return leases.get(lease.sourceId)!;
    },

    async releaseLease(lease, { now }) {
      if (!holdsLease(lease)) {
        return false;
      }

      leases.delete(lease.sourceId);
      append([
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
    },

    async startItem(lease, { ordinal, now, ttlMs }) {
      if (!holdsLease(lease)) {
        return { status: "lease_lost" };
      }

      const job = requireJob(lease.jobId);

      if (!isJobRunnable(job, now)) {
        return { status: "job_not_runnable", job };
      }

      const item = itemsOf(job.jobId)[ordinal];

      if (!item) {
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
      replaceItem(started);
      renew(lease, now, ttlMs);
      append([
        draftEvent({
          jobId: job.jobId,
          ordinal,
          eventType: "item_started",
          actor: lease.holder,
          leaseToken: lease.leaseToken,
          occurredAt: now,
          detail: { attempt: started.attempts, subjectKey: started.subjectKey },
        }),
      ]);

      return { status: "ok", item: started, job };
    },

    async finishItem(lease, { ordinal, decision, now, ttlMs }) {
      const item = itemsOf(lease.jobId)[ordinal];

      if (
        !holdsLease(lease) ||
        item === undefined ||
        item.status !== "running" ||
        item.leaseToken !== lease.leaseToken
      ) {
        return { status: "lease_lost" } satisfies FencedResult<ItemTransition>;
      }

      const job = requireJob(lease.jobId);
      const finished = applyItemDecision(item, decision, now);
      replaceItem(finished);
      const advanced = advanceJob(job, cursorOf(job), {
        now,
        actor: lease.holder,
        leaseToken: lease.leaseToken,
        jobNotBefore: decision.kind === "defer" ? decision.jobNotBefore : null,
      });
      jobs.set(job.jobId, advanced.job);
      renew(lease, now, ttlMs);
      append([
        ...decisionEvents(item, decision, {
          actor: lease.holder,
          leaseToken: lease.leaseToken,
          now,
        }),
        ...advanced.events,
      ]);

      return { status: "ok", item: finished, job: advanced.job };
    },

    async pauseJob(jobId, { now, reason }) {
      const job = requireJob(jobId);

      if (job.status !== "open") {
        throw new IngestionJobStateError(
          "job_terminal",
          `Job ${jobId} is ${job.status} and cannot be paused.`,
        );
      }

      const statusReason = ingestionJobReasonSchema.parse(reason);
      const paused = ingestionJobSchema.parse({
        ...job,
        status: "paused",
        statusReason,
        updatedAt: now,
      });
      jobs.set(jobId, paused);
      append([
        draftEvent({
          jobId,
          eventType: "job_paused",
          actor: OWNER_ACTOR,
          occurredAt: now,
          detail: { reason: statusReason },
        }),
      ]);

      return paused;
    },

    async resumeJob(jobId, { now, reason }) {
      const job = requireJob(jobId);

      if (!(
        job.status === "paused" ||
        (job.status === "open" && job.notBefore !== null)
      )) {
        throw new IngestionJobStateError(
          "job_not_paused",
          `Job ${jobId} is ${job.status} without a backoff; there is nothing to resume.`,
        );
      }

      const statusReason = ingestionJobReasonSchema.parse(reason);
      const resumed = ingestionJobSchema.parse({
        ...job,
        status: "open",
        notBefore: null,
        statusReason,
        updatedAt: now,
      });
      jobs.set(jobId, resumed);
      append([
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
    },

    async cancelJob(jobId, { now, reason }) {
      const job = requireJob(jobId);

      if (isTerminalJobStatus(job.status)) {
        throw new IngestionJobStateError(
          "job_terminal",
          `Job ${jobId} is already ${job.status}.`,
        );
      }

      if (leases.get(job.sourceId)?.jobId === jobId) {
        throw new IngestionJobStateError(
          "job_leased",
          `Job ${jobId} holds its source lease; pause it or release the lease first.`,
        );
      }

      const statusReason = ingestionJobReasonSchema.parse(reason);
      recoverOrphans(job.sourceId, { actor: OWNER_ACTOR, now });
      const cancelled = ingestionJobSchema.parse({
        ...requireJob(jobId),
        status: "cancelled",
        statusReason,
        notBefore: null,
        finishedAt: now,
        updatedAt: now,
      });
      jobs.set(jobId, cancelled);
      append([
        draftEvent({
          jobId,
          eventType: "job_cancelled",
          actor: OWNER_ACTOR,
          occurredAt: now,
          detail: { reason: statusReason, cursor: cancelled.cursor },
        }),
      ]);

      return cancelled;
    },

    async requeueItem(jobId, ordinal, { now, reason }) {
      const job = requireJob(jobId);

      if (job.status === "cancelled") {
        throw new IngestionJobStateError(
          "job_terminal",
          `Job ${jobId} is cancelled.`,
        );
      }

      const item = itemsOf(jobId)[ordinal];

      if (!item) {
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

      const statusReason = ingestionJobReasonSchema.parse(reason);
      const requeued = requeueItemState(item, now);
      replaceItem(requeued);
      const reopened = reopenJob(job, cursorOf(job), now);
      jobs.set(jobId, reopened);
      append([
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
    },

    async forceReleaseLease(sourceId, { now, reason }) {
      const statusReason = ingestionJobReasonSchema.parse(reason);
      const released = leases.get(sourceId) ?? null;

      if (released !== null) {
        leases.delete(sourceId);
        append([
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

      const recovered = recoverOrphans(sourceId, { actor: OWNER_ACTOR, now });

      return { released, recovered };
    },

    snapshot() {
      return {
        jobs: [...jobs.values()],
        items: [...items.values()].flat(),
        leases: [...leases.values()],
      };
    },
  };
}
