import {
  decideOrphanRecovery,
  ingestionJobEventSchema,
  ingestionJobItemSchema,
  ingestionJobSchema,
  isTerminalJobStatus,
  type IngestionJob,
  type IngestionJobEvent,
  type IngestionJobEventDetail,
  type IngestionJobEventType,
  type IngestionJobItem,
  type IngestionJobItemDecision,
} from "./ingestion-job";

/**
 * Transiciones de job e item como funciones puras.
 *
 * Los dos almacenes —el doble en memoria y PostgreSQL— las usan tal cual: leen
 * las filas bajo su propia exclusión, calculan acá el estado siguiente y lo
 * escriben. Así existe una sola implementación de la semántica y el contrato
 * compartido prueba la misma regla sobre los dos.
 */
export type IngestionJobEventDraft = Omit<IngestionJobEvent, "sequence">;

export function draftEvent(fields: {
  readonly jobId: string;
  readonly eventType: IngestionJobEventType;
  readonly actor: string;
  readonly occurredAt: string;
  readonly ordinal?: number | null;
  readonly leaseToken?: string | null;
  readonly detail?: IngestionJobEventDetail;
}): IngestionJobEventDraft {
  return ingestionJobEventSchema.omit({ sequence: true }).parse({
    ordinal: null,
    leaseToken: null,
    detail: {},
    ...fields,
  });
}

export class IngestionJobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionJobTransitionError";
  }
}

/** Un intento empieza sólo sobre un item pendiente cuyo backoff ya venció. */
export function isItemReady(item: IngestionJobItem, now: string): boolean {
  return (
    item.status === "pending" &&
    (item.notBefore === null || Date.parse(item.notBefore) <= Date.parse(now))
  );
}

export function isJobRunnable(job: IngestionJob, now: string): boolean {
  return (
    job.status === "open" &&
    (job.notBefore === null || Date.parse(job.notBefore) <= Date.parse(now))
  );
}

export function startItemAttempt(
  item: IngestionJobItem,
  leaseToken: string,
  now: string,
): IngestionJobItem {
  if (!isItemReady(item, now)) {
    throw new IngestionJobTransitionError(
      `Item ${item.ordinal} is not ready to start.`,
    );
  }

  return ingestionJobItemSchema.parse({
    ...item,
    status: "running",
    attempts: item.attempts + 1,
    notBefore: null,
    leaseToken,
    startedAt: now,
    updatedAt: now,
  });
}

export function applyItemDecision(
  item: IngestionJobItem,
  decision: IngestionJobItemDecision,
  now: string,
): IngestionJobItem {
  if (item.status !== "running") {
    throw new IngestionJobTransitionError(
      `Item ${item.ordinal} is not running.`,
    );
  }

  const base = {
    ...item,
    leaseToken: null,
    updatedAt: now,
    ingestionRunId: decision.ingestionRunId ?? item.ingestionRunId,
  };

  switch (decision.kind) {
    case "complete":
      return ingestionJobItemSchema.parse({
        ...base,
        status: "completed",
        notBefore: null,
        finishedAt: now,
      });
    case "fail":
    case "poison":
      return ingestionJobItemSchema.parse({
        ...base,
        status: decision.kind === "fail" ? "failed" : "poisoned",
        notBefore: null,
        finishedAt: now,
        lastFailure: decision.failure,
      });
    case "retry":
      return ingestionJobItemSchema.parse({
        ...base,
        status: "pending",
        notBefore: decision.notBefore,
        lastFailure: decision.failure,
      });
    case "defer":
      // La fuente frenó: el intento se devuelve y el item espera al job.
      return ingestionJobItemSchema.parse({
        ...base,
        status: "pending",
        attempts: Math.max(0, item.attempts - 1),
        notBefore: null,
        lastFailure: decision.failure,
      });
  }
}

const DECISION_EVENT: Readonly<
  Record<IngestionJobItemDecision["kind"], IngestionJobEventType>
> = {
  complete: "item_completed",
  fail: "item_failed",
  poison: "item_poisoned",
  retry: "item_retry_scheduled",
  defer: "item_deferred",
};

/** Eventos de un checkpoint, sin los del job: esos los agrega `advanceJob`. */
export function decisionEvents(
  before: IngestionJobItem,
  decision: IngestionJobItemDecision,
  context: {
    readonly actor: string;
    readonly leaseToken: string | null;
    readonly now: string;
  },
): IngestionJobEventDraft[] {
  const detail: IngestionJobEventDetail = {
    attempt: before.attempts,
    ingestionRunId: decision.ingestionRunId,
  };

  if (decision.kind !== "complete") {
    detail.code = decision.failure.code;
    detail.message = decision.failure.message;
  }

  if (decision.kind === "retry") {
    detail.notBefore = decision.notBefore;
  }

  const events = [
    draftEvent({
      jobId: before.jobId,
      ordinal: before.ordinal,
      eventType: DECISION_EVENT[decision.kind],
      actor: context.actor,
      leaseToken: context.leaseToken,
      occurredAt: context.now,
      detail,
    }),
  ];

  if (decision.kind === "defer") {
    events.push(
      draftEvent({
        jobId: before.jobId,
        ordinal: before.ordinal,
        eventType: "job_backoff",
        actor: context.actor,
        leaseToken: context.leaseToken,
        occurredAt: context.now,
        detail: { signal: decision.signal, notBefore: decision.jobNotBefore },
      }),
    );
  }

  return events;
}

/**
 * Estado del job después de cambiar sus items: cursor recalculado
 * (`computeJobCursor` o su equivalente en SQL), backoff de fuente acumulado y
 * cierre si no queda nada. Un job cancelado conserva su estado; uno pausado se
 * completa igual si su último item terminó.
 */
export function advanceJob(
  job: IngestionJob,
  cursor: number,
  context: {
    readonly now: string;
    readonly actor: string;
    readonly leaseToken: string | null;
    readonly jobNotBefore?: string | null;
  },
): { readonly job: IngestionJob; readonly events: IngestionJobEventDraft[] } {
  const requested = context.jobNotBefore ?? null;
  // Una espera ya vencida no se arrastra: el job no está esperando nada.
  const pending =
    job.notBefore !== null &&
    Date.parse(job.notBefore) > Date.parse(context.now)
      ? job.notBefore
      : null;
  const notBefore =
    requested === null
      ? pending
      : pending === null || Date.parse(requested) > Date.parse(pending)
        ? requested
        : pending;
  const completes =
    !isTerminalJobStatus(job.status) && cursor === job.itemCount;
  const next = ingestionJobSchema.parse({
    ...job,
    cursor,
    notBefore: completes ? null : notBefore,
    status: completes ? "completed" : job.status,
    finishedAt: completes ? context.now : job.finishedAt,
    updatedAt: context.now,
  });

  return {
    job: next,
    events: completes
      ? [
          draftEvent({
            jobId: job.jobId,
            eventType: "job_completed",
            actor: context.actor,
            leaseToken: context.leaseToken,
            occurredAt: context.now,
            detail: { itemCount: job.itemCount },
          }),
        ]
      : [],
  };
}

/**
 * Recupera un item huérfano. El llamador garantiza la condición: el item está
 * `running` con un token distinto del lease vigente de su fuente.
 */
export function recoverOrphanItem(
  item: IngestionJobItem,
  maxAttempts: number,
  context: {
    readonly actor: string;
    readonly leaseToken: string | null;
    readonly now: string;
  },
): {
  readonly item: IngestionJobItem;
  readonly events: IngestionJobEventDraft[];
} {
  const decision = decideOrphanRecovery(item, maxAttempts);
  const recovered = applyItemDecision(item, decision, context.now);

  return {
    item: recovered,
    events: [
      draftEvent({
        jobId: item.jobId,
        ordinal: item.ordinal,
        eventType:
          decision.kind === "poison" ? "item_poisoned" : "item_recovered",
        actor: context.actor,
        leaseToken: context.leaseToken,
        occurredAt: context.now,
        detail: {
          attempt: item.attempts,
          code: decision.failure.code,
          orphanLeaseToken: item.leaseToken,
        },
      }),
    ],
  };
}

export function requeueItemState(
  item: IngestionJobItem,
  now: string,
): IngestionJobItem {
  if (item.status !== "failed" && item.status !== "poisoned") {
    throw new IngestionJobTransitionError(
      `Item ${item.ordinal} is ${item.status} and cannot be requeued.`,
    );
  }

  return ingestionJobItemSchema.parse({
    ...item,
    status: "pending",
    attempts: 0,
    notBefore: null,
    finishedAt: null,
    updatedAt: now,
  });
}

/**
 * Estado del job después de reencolar: el cursor retrocede al item devuelto y un
 * job completado vuelve a abrirse. Uno cancelado no: cancelar es definitivo.
 */
export function reopenJob(
  job: IngestionJob,
  cursor: number,
  now: string,
): IngestionJob {
  if (job.status === "cancelled") {
    throw new IngestionJobTransitionError(
      `Job ${job.jobId} is cancelled and cannot be reopened.`,
    );
  }

  return ingestionJobSchema.parse({
    ...job,
    cursor,
    status: job.status === "completed" ? "open" : job.status,
    finishedAt: null,
    updatedAt: now,
  });
}
