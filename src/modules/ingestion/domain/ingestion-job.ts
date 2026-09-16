import { z } from "zod";

import { computeContentHash } from "./content-hash";
import {
  MAX_FAILURE_MESSAGE_LENGTH,
  redactFailureMessage,
} from "./ingestion-failure";
import { selectionVersionSchema, subjectKeySchema } from "./ingestion-run";
import {
  datasetIdSchema,
  parserVersionSchema,
  sourceIdSchema,
} from "./source-registry-entry";

/**
 * Jobs durables de ingesta
 * ([ADR 0015](../../../../docs/architecture/adr/0015-durable-ingestion-jobs.md)).
 *
 * Un job es un plan fijo de sujetos que se procesan **en orden**, de a uno, bajo
 * un lease por fuente. El cursor es el ordinal del primer item no terminal: todo
 * lo anterior terminó —completado, fallado o envenenado— y nada posterior empezó.
 * Un proceso que muere deja su item `running` con un token que ya no es el del
 * lease; el próximo que toma la fuente lo recupera, y el intento cuenta. Así un
 * sujeto que tumba al proceso termina `poisoned` en vez de tumbarlo para siempre
 * (`TM-11`).
 *
 * Nada de este archivo lee un reloj: cada instante llega como argumento.
 */
export const INGESTION_JOB_RULE_VERSION = "ingestion-job-1.0.0";

/** Techo de sujetos por job: el universo y sus antecesores, con margen. */
export const MAX_INGESTION_JOB_ITEMS = 10_000;

export const ingestionJobKindSchema = z.enum(["sec_companyfacts_backfill"]);

export type IngestionJobKind = z.infer<typeof ingestionJobKindSchema>;

/**
 * `completed` y `cancelled` son terminales. Si un job está siendo procesado no es
 * un estado del job sino del lease de su fuente: un proceso muerto no puede dejar
 * un job «corriendo» para siempre.
 */
export const ingestionJobStatusSchema = z.enum([
  "open",
  "paused",
  "completed",
  "cancelled",
]);

export type IngestionJobStatus = z.infer<typeof ingestionJobStatusSchema>;

export const ingestionJobItemStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "poisoned",
]);

export type IngestionJobItemStatus = z.infer<
  typeof ingestionJobItemStatusSchema
>;

const TERMINAL_ITEM_STATUSES: ReadonlySet<IngestionJobItemStatus> = new Set([
  "completed",
  "failed",
  "poisoned",
]);

export function isTerminalItemStatus(status: IngestionJobItemStatus): boolean {
  return TERMINAL_ITEM_STATUSES.has(status);
}

export function isTerminalJobStatus(status: IngestionJobStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * Por qué falló el último intento de un item.
 *
 * - `ingestion_failed`: la corrida de ingesta quedó `failed`; su fila dice por qué.
 * - `subject_rejected`: el sujeto se rechazó antes de salir a la red, de forma
 *   determinista.
 * - `executor_error`: una excepción que nadie clasificó.
 * - `lease_expired`: el intento quedó sin terminar porque el proceso murió o
 *   perdió el lease.
 * - `source_signal`: la fuente frenó al cliente; no es culpa del sujeto.
 */
export const ingestionJobFailureCodeSchema = z.enum([
  "ingestion_failed",
  "subject_rejected",
  "executor_error",
  "lease_expired",
  "source_signal",
]);

export type IngestionJobFailureCode = z.infer<
  typeof ingestionJobFailureCodeSchema
>;

export const ingestionJobFailureSchema = z.object({
  code: ingestionJobFailureCodeSchema,
  message: z.string().trim().min(1).max(MAX_FAILURE_MESSAGE_LENGTH),
  retryable: z.boolean(),
});

export type IngestionJobFailure = z.infer<typeof ingestionJobFailureSchema>;

export function toIngestionJobFailure(
  code: IngestionJobFailureCode,
  message: string,
  retryable: boolean,
): IngestionJobFailure {
  return ingestionJobFailureSchema.parse({
    code,
    message: redactFailureMessage(message),
    retryable,
  });
}

export const ingestionJobEventTypeSchema = z.enum([
  "job_created",
  "job_paused",
  "job_resumed",
  "job_cancelled",
  "job_completed",
  "job_reopened",
  "job_backoff",
  "lease_acquired",
  "lease_taken_over",
  "lease_released",
  "lease_force_released",
  "item_started",
  "item_completed",
  "item_failed",
  "item_retry_scheduled",
  "item_poisoned",
  "item_deferred",
  "item_recovered",
  "item_requeued",
]);

export type IngestionJobEventType = z.infer<typeof ingestionJobEventTypeSchema>;

const utcTimestampSchema = z.iso.datetime({ offset: true });
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/**
 * Quién actuó: el identificador de un proceso worker o `owner` para una
 * recuperación manual. Nunca un secreto ni texto libre.
 */
export const ingestionJobActorSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:@/-]{1,128}$/u);

export const OWNER_ACTOR = "owner";

/** Motivo declarado de una acción manual: se redacta antes de persistirse. */
export const ingestionJobReasonSchema = z
  .string()
  .trim()
  .min(3)
  .max(MAX_FAILURE_MESSAGE_LENGTH)
  .transform((value) => redactFailureMessage(value));

const eventDetailValueSchema = z.union([
  z.string().max(MAX_FAILURE_MESSAGE_LENGTH),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const ingestionJobEventDetailSchema = z
  .record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/u),
    eventDetailValueSchema,
  )
  .refine((detail) => Object.keys(detail).length <= 16, {
    message: "An event detail carries at most 16 keys.",
  });

export type IngestionJobEventDetail = z.infer<
  typeof ingestionJobEventDetailSchema
>;

export const ingestionJobPlanSchema = z
  .object({
    kind: ingestionJobKindSchema,
    sourceId: sourceIdSchema,
    datasetId: datasetIdSchema,
    parserVersion: parserVersionSchema,
    selectionVersion: selectionVersionSchema.nullable(),
    /** En el orden en que se procesan: el orden es parte del plan. */
    subjects: z.array(subjectKeySchema).min(1).max(MAX_INGESTION_JOB_ITEMS),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  })
  .superRefine((plan, context) => {
    const seen = new Set<string>();

    plan.subjects.forEach((subject, index) => {
      if (seen.has(subject)) {
        context.addIssue({
          code: "custom",
          path: ["subjects", index],
          message: "A subject appears more than once in the plan.",
        });
      }
      seen.add(subject);
    });
  });

export type IngestionJobPlan = z.infer<typeof ingestionJobPlanSchema>;
export type IngestionJobPlanInput = z.input<typeof ingestionJobPlanSchema>;

/**
 * Identidad del trabajo pedido. Dos planes con el mismo hash son el mismo
 * trabajo: pedirlo de nuevo mientras sigue abierto devuelve el existente
 * (`TM-11`). `maxAttempts` es política y no contenido, así que no entra.
 */
export function computeIngestionJobPlanHash(plan: IngestionJobPlan): string {
  return computeContentHash({
    kind: plan.kind,
    sourceId: plan.sourceId,
    datasetId: plan.datasetId,
    parserVersion: plan.parserVersion,
    selectionVersion: plan.selectionVersion,
    subjects: plan.subjects,
  });
}

export const ingestionJobSchema = z
  .object({
    jobId: z.uuid(),
    kind: ingestionJobKindSchema,
    sourceId: sourceIdSchema,
    datasetId: datasetIdSchema,
    parserVersion: parserVersionSchema,
    selectionVersion: selectionVersionSchema.nullable(),
    planHash: contentHashSchema,
    itemCount: z.number().int().min(1).max(MAX_INGESTION_JOB_ITEMS),
    maxAttempts: z.number().int().min(1).max(10),
    status: ingestionJobStatusSchema,
    /** Ordinal del primer item no terminal; `itemCount` cuando no queda ninguno. */
    cursor: z.number().int().min(0),
    /** Backoff del job entero: la fuente pidió esperar. */
    notBefore: utcTimestampSchema.nullable(),
    statusReason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_FAILURE_MESSAGE_LENGTH)
      .nullable(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    finishedAt: utcTimestampSchema.nullable(),
  })
  .superRefine((job, context) => {
    const terminal = isTerminalJobStatus(job.status);

    if (job.cursor > job.itemCount) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "The cursor cannot pass the last item.",
      });
    }

    if (terminal === (job.finishedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must be present exactly for terminal jobs.",
      });
    }

    if (job.status === "completed" && job.cursor !== job.itemCount) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "A completed job has no item left.",
      });
    }

    if (!terminal && job.cursor >= job.itemCount) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "An open or paused job still has an item to process.",
      });
    }
  });

export type IngestionJob = z.infer<typeof ingestionJobSchema>;

export const ingestionJobItemSchema = z
  .object({
    jobId: z.uuid(),
    ordinal: z.number().int().min(0),
    subjectKey: subjectKeySchema,
    status: ingestionJobItemStatusSchema,
    /** Intentos empezados; uno que la fuente frenó se devuelve. */
    attempts: z.number().int().min(0),
    notBefore: utcTimestampSchema.nullable(),
    /** Token del lease bajo el que corre el intento en curso. */
    leaseToken: z.uuid().nullable(),
    startedAt: utcTimestampSchema.nullable(),
    finishedAt: utcTimestampSchema.nullable(),
    /** Corrida de ingesta del último intento que llegó a registrar una. */
    ingestionRunId: z.uuid().nullable(),
    lastFailure: ingestionJobFailureSchema.nullable(),
    updatedAt: utcTimestampSchema,
  })
  .superRefine((item, context) => {
    const running = item.status === "running";

    if (running !== (item.leaseToken !== null)) {
      context.addIssue({
        code: "custom",
        path: ["leaseToken"],
        message: "Exactly a running item carries a lease token.",
      });
    }

    if (running && item.startedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "A running item has started.",
      });
    }

    if (isTerminalItemStatus(item.status) === (item.finishedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must be present exactly for terminal items.",
      });
    }

    if (item.status === "completed" && item.ingestionRunId === null) {
      context.addIssue({
        code: "custom",
        path: ["ingestionRunId"],
        message: "A completed item points at its ingestion run.",
      });
    }

    if (
      (item.status === "failed" || item.status === "poisoned") &&
      item.lastFailure === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastFailure"],
        message: "A failed or poisoned item says why.",
      });
    }

    if (
      item.status === "pending" &&
      item.attempts > 0 &&
      item.lastFailure === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastFailure"],
        message:
          "A pending item that was already attempted says why it returned.",
      });
    }

    if (item.status !== "pending" && item.notBefore !== null) {
      context.addIssue({
        code: "custom",
        path: ["notBefore"],
        message: "Only a pending item waits for a backoff.",
      });
    }
  });

export type IngestionJobItem = z.infer<typeof ingestionJobItemSchema>;

export const ingestionLeaseSchema = z
  .object({
    sourceId: sourceIdSchema,
    jobId: z.uuid(),
    holder: ingestionJobActorSchema,
    leaseToken: z.uuid(),
    acquiredAt: utcTimestampSchema,
    heartbeatAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
  })
  .superRefine((lease, context) => {
    if (Date.parse(lease.heartbeatAt) < Date.parse(lease.acquiredAt)) {
      context.addIssue({
        code: "custom",
        path: ["heartbeatAt"],
        message: "A heartbeat cannot precede the acquisition.",
      });
    }

    if (Date.parse(lease.expiresAt) <= Date.parse(lease.heartbeatAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "A lease expires after its last heartbeat.",
      });
    }
  });

export type IngestionLease = z.infer<typeof ingestionLeaseSchema>;

/** Lo que un worker necesita para demostrar que sigue siendo el dueño. */
export type IngestionLeaseHandle = Pick<
  IngestionLease,
  "sourceId" | "jobId" | "holder" | "leaseToken"
>;

/**
 * Vencer habilita que otro tome el lease; no lo quita. Mientras nadie lo tome, el
 * token sigue siendo del mismo holder y sus escrituras siguen valiendo: la
 * protección contra un proceso zombi es el token, no el reloj.
 */
export function isLeaseExpired(lease: IngestionLease, now: string): boolean {
  return Date.parse(lease.expiresAt) <= Date.parse(now);
}

export function addMilliseconds(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

export const ingestionJobEventSchema = z.object({
  /** Orden total de los eventos: varios comparten instante con un reloj fijo. */
  sequence: z.number().int().positive(),
  jobId: z.uuid(),
  ordinal: z.number().int().min(0).nullable(),
  eventType: ingestionJobEventTypeSchema,
  actor: ingestionJobActorSchema,
  leaseToken: z.uuid().nullable(),
  occurredAt: utcTimestampSchema,
  detail: ingestionJobEventDetailSchema,
});

export type IngestionJobEvent = z.infer<typeof ingestionJobEventSchema>;

/**
 * Política del job. Los tiempos no salen de lo que tolera la fuente sino de lo
 * que el proceso necesita: el TTL cubre cinco latidos perdidos y un intento de
 * la SEC termina, en el peor caso medido, en menos de un minuto.
 */
export type IngestionJobPolicy = {
  readonly leaseTtlMs: number;
  readonly heartbeatIntervalMs: number;
  /** Backoff de un reintento: `base · 4^(intento − 1)`, con techo. */
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  /** Espera más larga que el worker hace sin soltar el lease. */
  readonly maxInlineWaitMs: number;
  /**
   * Señales de la fuente seguidas que una corrida tolera esperando. La siguiente
   * la frena: una fuente que sigue fallando no se espera indefinidamente.
   */
  readonly maxConsecutiveSourceSignals: number;
  /** Espera del job cuando la fuente frena, si no dice cuánto. */
  readonly sourceBackoffMs: Readonly<Record<SourceSignalKind, number>>;
  readonly minSourceBackoffMs: number;
  readonly maxSourceBackoffMs: number;
};

export const INGESTION_JOB_POLICY: IngestionJobPolicy = Object.freeze({
  leaseTtlMs: 5 * 60_000,
  heartbeatIntervalMs: 60_000,
  retryBaseMs: 30_000,
  retryMaxMs: 15 * 60_000,
  maxInlineWaitMs: 5 * 60_000,
  maxConsecutiveSourceSignals: 3,
  sourceBackoffMs: Object.freeze({
    // La SEC bloquea diez minutos a quien excede su ritmo.
    throttled: 10 * 60_000,
    refused: 10 * 60_000,
    // Medido el 2026-09-16: un `transport_error` suelto en un archivo histórico
    // de JPMorgan. Un corte así se resuelve en segundos; un minuto alcanza y la
    // corrida lo espera sin soltar el lease.
    unavailable: 60_000,
  }),
  minSourceBackoffMs: 60_000,
  maxSourceBackoffMs: 60 * 60_000,
});

/**
 * Señales de la fuente, no del sujeto:
 *
 * - `throttled`: pidió bajar el ritmo (`429`);
 * - `refused`: rechazó al cliente o su configuración (un `403`, derechos sin
 *   aprobar);
 * - `unavailable`: no respondió o respondió que no puede (`503`, red caída).
 *
 * Ninguna gasta un intento del item: marcar el universo como fallido porque la
 * fuente estuvo caída diez minutos sería envenenar sujetos sanos.
 */
export const sourceSignalKindSchema = z.enum([
  "throttled",
  "refused",
  "unavailable",
]);

export type SourceSignalKind = z.infer<typeof sourceSignalKindSchema>;

export type IngestionJobAttemptOutcome =
  | { readonly kind: "ingested"; readonly ingestionRunId: string }
  | {
      readonly kind: "ingestion_failed";
      readonly ingestionRunId: string;
      readonly retryable: boolean;
      readonly message: string;
    }
  | { readonly kind: "subject_rejected"; readonly message: string }
  | { readonly kind: "executor_error"; readonly message: string }
  | {
      readonly kind: "source_signal";
      readonly signal: SourceSignalKind;
      readonly ingestionRunId: string | null;
      /** `Retry-After` sin interpretar. */
      readonly retryAfter: string | null;
      readonly message: string;
    };

export type IngestionJobItemDecision =
  | { readonly kind: "complete"; readonly ingestionRunId: string }
  | {
      readonly kind: "fail";
      readonly ingestionRunId: string | null;
      readonly failure: IngestionJobFailure;
    }
  | {
      readonly kind: "poison";
      readonly ingestionRunId: string | null;
      readonly failure: IngestionJobFailure;
    }
  | {
      readonly kind: "retry";
      readonly ingestionRunId: string | null;
      readonly failure: IngestionJobFailure;
      /** `null`: reintentable ya. */
      readonly notBefore: string | null;
    }
  | {
      readonly kind: "defer";
      readonly ingestionRunId: string | null;
      readonly failure: IngestionJobFailure;
      readonly signal: SourceSignalKind;
      readonly jobNotBefore: string;
    };

const RETRY_AFTER_SECONDS = /^[0-9]{1,9}$/u;

/**
 * `Retry-After` en segundos o como fecha HTTP. Lo que no se entiende devuelve
 * `null` y la política usa su propio default; nunca un cero que reintente ya.
 */
export function parseRetryAfterMs(
  value: string | null,
  now: string,
): number | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (RETRY_AFTER_SECONDS.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  if (!/[a-z]/iu.test(trimmed)) {
    return null;
  }

  const at = Date.parse(trimmed);

  return Number.isNaN(at) ? null : Math.max(0, at - Date.parse(now));
}

export function computeSourceBackoffMs(
  signal: SourceSignalKind,
  retryAfter: string | null,
  now: string,
  policy: IngestionJobPolicy = INGESTION_JOB_POLICY,
): number {
  const requested =
    parseRetryAfterMs(retryAfter, now) ?? policy.sourceBackoffMs[signal];

  return Math.min(
    policy.maxSourceBackoffMs,
    Math.max(policy.minSourceBackoffMs, requested),
  );
}

export function computeRetryBackoffMs(
  attempts: number,
  policy: IngestionJobPolicy = INGESTION_JOB_POLICY,
): number {
  const exponent = Math.max(0, attempts - 1);

  return Math.min(policy.retryMaxMs, policy.retryBaseMs * 4 ** exponent);
}

/**
 * Qué hacer con un item después de un intento. `attempts` ya cuenta el intento
 * que acaba de terminar.
 */
export function decideItemAttempt(
  outcome: IngestionJobAttemptOutcome,
  context: {
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly now: string;
    readonly policy?: IngestionJobPolicy;
  },
): IngestionJobItemDecision {
  const policy = context.policy ?? INGESTION_JOB_POLICY;
  const exhausted = context.attempts >= context.maxAttempts;

  const retryOrPoison = (
    ingestionRunId: string | null,
    failure: IngestionJobFailure,
  ): IngestionJobItemDecision =>
    exhausted
      ? { kind: "poison", ingestionRunId, failure }
      : {
          kind: "retry",
          ingestionRunId,
          failure,
          notBefore: addMilliseconds(
            context.now,
            computeRetryBackoffMs(context.attempts, policy),
          ),
        };

  switch (outcome.kind) {
    case "ingested":
      return { kind: "complete", ingestionRunId: outcome.ingestionRunId };
    case "ingestion_failed": {
      const failure = toIngestionJobFailure(
        "ingestion_failed",
        outcome.message,
        outcome.retryable,
      );

      return outcome.retryable
        ? retryOrPoison(outcome.ingestionRunId, failure)
        : { kind: "fail", ingestionRunId: outcome.ingestionRunId, failure };
    }
    case "subject_rejected":
      return {
        kind: "fail",
        ingestionRunId: null,
        failure: toIngestionJobFailure(
          "subject_rejected",
          outcome.message,
          false,
        ),
      };
    case "executor_error":
      // Una excepción sin clasificar se reintenta con techo: es exactamente el
      // mensaje venenoso que la política existe para aislar.
      return retryOrPoison(
        null,
        toIngestionJobFailure("executor_error", outcome.message, true),
      );
    case "source_signal":
      return {
        kind: "defer",
        ingestionRunId: outcome.ingestionRunId,
        signal: outcome.signal,
        failure: toIngestionJobFailure(
          "source_signal",
          `${outcome.signal}: ${outcome.message}`,
          true,
        ),
        jobNotBefore: addMilliseconds(
          context.now,
          computeSourceBackoffMs(
            outcome.signal,
            outcome.retryAfter,
            context.now,
            policy,
          ),
        ),
      };
  }
}

/**
 * Un item que quedó `running` bajo un token que ya no es el del lease: su proceso
 * murió o fue declarado muerto. El intento ya estaba contado, así que un sujeto
 * que tumba al proceso se envenena al llegar al techo.
 */
export function decideOrphanRecovery(
  item: IngestionJobItem,
  maxAttempts: number,
): Extract<IngestionJobItemDecision, { kind: "poison" | "retry" }> {
  const failure = toIngestionJobFailure(
    "lease_expired",
    "El intento quedó sin terminar: su proceso perdió el lease.",
    true,
  );

  return item.attempts >= maxAttempts
    ? { kind: "poison", ingestionRunId: item.ingestionRunId, failure }
    : {
        kind: "retry",
        ingestionRunId: item.ingestionRunId,
        failure,
        // Sin espera: el tiempo que tardó en vencer el lease ya fue la espera.
        notBefore: null,
      };
}

export type IngestionJobItemCounts = Readonly<
  Record<IngestionJobItemStatus, number>
>;

export const EMPTY_ITEM_COUNTS: IngestionJobItemCounts = Object.freeze({
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  poisoned: 0,
});

/**
 * Cursor de un job: el primer item no terminal. Se recalcula en cada transición
 * en vez de sumarse, así que reencolar un item anterior lo hace retroceder sin
 * una regla aparte.
 */
export function computeJobCursor(
  items: readonly Pick<IngestionJobItem, "ordinal" | "status">[],
  itemCount: number,
): number {
  let cursor = itemCount;

  for (const item of items) {
    if (!isTerminalItemStatus(item.status) && item.ordinal < cursor) {
      cursor = item.ordinal;
    }
  }

  return cursor;
}
