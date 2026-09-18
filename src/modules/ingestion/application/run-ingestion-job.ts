import { z } from "zod";

import {
  INGESTION_JOB_POLICY,
  decideItemAttempt,
  ingestionJobActorSchema,
  isTerminalJobStatus,
  type IngestionJob,
  type IngestionJobAttemptOutcome,
  type IngestionJobItem,
  type IngestionJobItemDecision,
  type IngestionJobPolicy,
  type IngestionLease,
  type IngestionLeaseHandle,
} from "@/modules/ingestion/domain/ingestion-job";
import { isJobRunnable } from "@/modules/ingestion/domain/ingestion-job-transitions";
import { redactFailureMessage } from "@/modules/ingestion/domain/ingestion-failure";

import type { IngestionJobStore } from "./ingestion-job-store";

/**
 * Worker de un job durable (ADR 0015).
 *
 * El recorrido es siempre el mismo: tomar el lease de la fuente, empezar el item
 * del cursor, ejecutarlo, registrar la decisión con un checkpoint cercado y
 * seguir. Entre medio un latido renueva el lease mientras el proceso viva; si el
 * proceso muere, el lease vence y el próximo worker recupera el item.
 *
 * El worker no sabe qué es un item: lo ejecuta un `IngestionJobExecutor` que
 * clasifica el resultado. La entrega es **al menos una vez** —un intento cuyo
 * checkpoint no llega se repite—, así que el ejecutor tiene que ser idempotente,
 * y lo es: la ingesta deduplica por contenido (ADR 0010, `TM-11`).
 */
export type IngestionJobExecutor = (
  item: IngestionJobItem,
  job: IngestionJob,
) => Promise<IngestionJobAttemptOutcome>;

export type IngestionJobStopReason =
  /** No queda item por procesar. */
  | "completed"
  /** El job está pausado, cancelado o esperando un backoff de la fuente. */
  | "job_not_runnable"
  /** Otro proceso vivo tiene el lease de la fuente. */
  | "source_busy"
  /** Otro proceso tomó el lease: este dejó de ser el dueño. */
  | "lease_lost"
  /** Se alcanzó el techo de intentos pedido para esta corrida. */
  | "attempt_limit"
  /** El presupuesto de la corrida no alcanza para el peor caso de un item. */
  | "budget_reserve"
  /** El owner frenó la fuente con el kill switch (ADR 0020). */
  | "source_disabled"
  /** La cuota del día de la fuente está gastada (ADR 0020). */
  | "daily_budget_exhausted"
  /** El item del cursor espera un backoff más largo que el tolerable. */
  | "item_backoff"
  /**
   * La fuente frenó al cliente por más de lo que se espera en línea, o varias
   * veces seguidas: el job quedó esperando.
   */
  | "source_signal"
  /** El proceso pidió parar: termina el item en curso y suelta el lease. */
  | "interrupted";

/**
 * Si el próximo item puede empezar. Reúne en una sola decisión el presupuesto de
 * la corrida y los dos controles por fuente, para que el worker tenga un único
 * punto donde preguntar y cada negativa llegue con su nombre.
 */
export type IngestionJobAdmission =
  | { readonly status: "ready" }
  | { readonly status: "budget_reserve" }
  | { readonly status: "source_disabled"; readonly reason: string }
  | {
      readonly status: "daily_budget_exhausted";
      /** Cuándo se repone el contador de la fuente. */
      readonly resumesAt: string;
    };

export type IngestionJobAttemptReport = {
  readonly ordinal: number;
  readonly subjectKey: string;
  readonly attempt: number;
  readonly outcome: IngestionJobAttemptOutcome;
  readonly decision: IngestionJobItemDecision;
};

export type RunIngestionJobResult = {
  readonly stopReason: IngestionJobStopReason;
  readonly job: IngestionJob;
  /** `null` cuando no se llegó a tomar el lease. */
  readonly lease: IngestionLease | null;
  readonly takenOver: IngestionLease | null;
  readonly recovered: readonly IngestionJobItem[];
  /** Lease ajeno que impidió correr. */
  readonly busyLease: IngestionLease | null;
  readonly attempts: readonly IngestionJobAttemptReport[];
  /** Hasta cuándo espera el job o su item, si la corrida paró por eso. */
  readonly waitUntil: string | null;
  /** Motivo de la negativa de admisión, si la corrida paró por una. */
  readonly admissionReason: string | null;
  readonly heartbeatFailures: number;
};

export const runIngestionJobRequestSchema = z.object({
  jobId: z.uuid(),
  holder: ingestionJobActorSchema,
  /** Techo de intentos de esta corrida; sin techo, hasta terminar o frenar. */
  attemptLimit: z.number().int().min(1).max(100_000).optional(),
});

export type RunIngestionJobRequest = z.input<
  typeof runIngestionJobRequestSchema
>;

export type RunIngestionJobDependencies = {
  readonly store: IngestionJobStore;
  readonly execute: IngestionJobExecutor;
  /** Reloj inyectado: el worker no lee `Date.now()`. */
  readonly now: () => string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly newLeaseToken: () => string;
  /**
   * Arranca un latido periódico y devuelve cómo pararlo. La raíz de composición
   * usa un temporizador; un test lo dispara a mano.
   */
  readonly startHeartbeat: (
    beat: () => Promise<void>,
    intervalMs: number,
  ) => () => void;
  /**
   * Si el próximo item puede empezar. Se consulta **antes** de contar el intento,
   * así que una negativa no gasta intentos ni envenena sujetos sanos: una fuente
   * frenada o sin cuota no es un problema del sujeto.
   */
  readonly admitItem?: () =>
    IngestionJobAdmission | Promise<IngestionJobAdmission>;
  /** `true` cuando el proceso pidió parar (una señal del sistema, por ejemplo). */
  readonly shouldStop?: () => boolean;
  readonly onAttempt?: (report: IngestionJobAttemptReport) => void;
  readonly policy?: IngestionJobPolicy;
};

/**
 * Mensaje de una excepción sin clasificar. Se usa la causa más interna: el error
 * de un driver envuelve la sentencia entera, y con el techo de 240 caracteres la
 * sentencia tapaba el motivo (medido el 2026-09-16, un índice único).
 */
function messageOf(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return redactFailureMessage(String(cause));
  }

  let innermost: Error = cause;

  for (
    let depth = 0;
    depth < 8 && innermost.cause instanceof Error;
    depth += 1
  ) {
    innermost = innermost.cause;
  }

  return redactFailureMessage(
    innermost === cause
      ? `${cause.name}: ${cause.message}`
      : `${cause.name} ← ${innermost.name}: ${innermost.message}`,
  );
}

export async function runIngestionJob(
  request: RunIngestionJobRequest,
  dependencies: RunIngestionJobDependencies,
): Promise<RunIngestionJobResult> {
  const { jobId, holder, attemptLimit } =
    runIngestionJobRequestSchema.parse(request);
  const { store, execute, now, sleep, newLeaseToken, startHeartbeat } =
    dependencies;
  const policy = dependencies.policy ?? INGESTION_JOB_POLICY;
  const ttlMs = policy.leaseTtlMs;

  const acquisition = await store.acquireLease({
    jobId,
    holder,
    leaseToken: newLeaseToken(),
    now: now(),
    ttlMs,
  });

  if (acquisition.status !== "acquired") {
    const job =
      acquisition.status === "job_not_runnable"
        ? acquisition.job
        : ((await store.getJob(jobId)) as IngestionJob);

    return {
      stopReason:
        acquisition.status === "busy" ? "source_busy" : "job_not_runnable",
      job,
      lease: null,
      takenOver: null,
      recovered: [],
      busyLease: acquisition.status === "busy" ? acquisition.lease : null,
      attempts: [],
      waitUntil: job.notBefore,
      admissionReason: null,
      heartbeatFailures: 0,
    };
  }

  const lease = acquisition.lease;
  const handle: IngestionLeaseHandle = {
    sourceId: lease.sourceId,
    jobId: lease.jobId,
    holder: lease.holder,
    leaseToken: lease.leaseToken,
  };
  const attempts: IngestionJobAttemptReport[] = [];
  let leaseLost = false;
  let heartbeatFailures = 0;
  let beating = false;

  const stopHeartbeat = startHeartbeat(async () => {
    // Un latido lento no se superpone con el siguiente.
    if (beating || leaseLost) {
      return;
    }

    beating = true;

    try {
      const renewed = await store.heartbeat(handle, { now: now(), ttlMs });

      if (renewed === null) {
        leaseLost = true;
      }
    } catch {
      // Un latido fallido no decide nada: la próxima escritura cercada sí.
      heartbeatFailures += 1;
    } finally {
      beating = false;
    }
  }, policy.heartbeatIntervalMs);

  let job = acquisition.job;
  let consecutiveSignals = 0;
  let stopReason: IngestionJobStopReason;
  let waitUntil: string | null = null;
  let admissionReason: string | null = null;

  try {
    for (;;) {
      if (leaseLost) {
        stopReason = "lease_lost";
        break;
      }

      const next = await store.peekNext(jobId);
      job = next.job;

      if (isTerminalJobStatus(job.status) || next.item === null) {
        stopReason =
          job.status === "completed" ? "completed" : "job_not_runnable";
        break;
      }

      if (job.status !== "open") {
        stopReason = "job_not_runnable";
        break;
      }

      if (!isJobRunnable(job, now())) {
        // Sólo este worker escribe el backoff mientras tiene el lease: es el de
        // una señal que ya se decidió esperar. El latido sigue mientras tanto.
        const waitMs = Date.parse(job.notBefore!) - Date.parse(now());

        if (waitMs > policy.maxInlineWaitMs) {
          stopReason = "job_not_runnable";
          waitUntil = job.notBefore;
          break;
        }

        await sleep(waitMs);
        continue;
      }

      if (attemptLimit !== undefined && attempts.length >= attemptLimit) {
        stopReason = "attempt_limit";
        break;
      }

      if (dependencies.shouldStop?.()) {
        stopReason = "interrupted";
        break;
      }

      if (dependencies.admitItem) {
        const admission = await dependencies.admitItem();

        if (admission.status !== "ready") {
          stopReason = admission.status;

          if (admission.status === "daily_budget_exhausted") {
            waitUntil = admission.resumesAt;
          }

          if (admission.status === "source_disabled") {
            admissionReason = admission.reason;
          }

          break;
        }
      }

      const item = next.item;

      if (item.notBefore !== null) {
        const waitMs = Date.parse(item.notBefore) - Date.parse(now());

        if (waitMs > policy.maxInlineWaitMs) {
          stopReason = "item_backoff";
          waitUntil = item.notBefore;
          break;
        }

        if (waitMs > 0) {
          // El latido sigue corriendo mientras se espera: el lease no vence.
          await sleep(waitMs);
          continue;
        }
      }

      const started = await store.startItem(handle, {
        ordinal: item.ordinal,
        now: now(),
        ttlMs,
      });

      if (started.status === "lease_lost") {
        stopReason = "lease_lost";
        break;
      }

      if (started.status === "job_not_runnable") {
        job = started.job;
        stopReason = "job_not_runnable";
        waitUntil = job.notBefore;
        break;
      }

      let outcome: IngestionJobAttemptOutcome;

      try {
        outcome = await execute(started.item, started.job);
      } catch (cause) {
        outcome = { kind: "executor_error", message: messageOf(cause) };
      }

      const finishedAt = now();
      const decision = decideItemAttempt(outcome, {
        attempts: started.item.attempts,
        maxAttempts: started.job.maxAttempts,
        now: finishedAt,
        policy,
      });
      const finished = await store.finishItem(handle, {
        ordinal: item.ordinal,
        decision,
        now: finishedAt,
        ttlMs,
      });

      if (finished.status !== "ok") {
        // El intento ocurrió pero su resultado no quedó: el nuevo dueño lo repite.
        stopReason = "lease_lost";
        break;
      }

      job = finished.job;
      const report = {
        ordinal: item.ordinal,
        subjectKey: item.subjectKey,
        attempt: started.item.attempts,
        outcome,
        decision,
      };
      attempts.push(report);
      dependencies.onAttempt?.(report);

      if (decision.kind !== "defer") {
        consecutiveSignals = 0;
        continue;
      }

      consecutiveSignals += 1;
      const signalWaitMs = Date.parse(job.notBefore!) - Date.parse(now());

      if (
        consecutiveSignals >= policy.maxConsecutiveSourceSignals ||
        signalWaitMs > policy.maxInlineWaitMs
      ) {
        stopReason = "source_signal";
        waitUntil = job.notBefore;
        break;
      }
    }
  } catch (error) {
    stopHeartbeat();
    // El error original es el que importa; si además no se puede soltar el
    // lease, vence solo y el próximo worker recupera el item.
    await store.releaseLease(handle, { now: now() }).catch(() => false);
    throw error;
  }

  stopHeartbeat();
  // Soltar sólo si sigue siendo propio: un lease ajeno no se toca.
  await store.releaseLease(handle, { now: now() });

  return {
    stopReason,
    job: (await store.getJob(jobId)) ?? job,
    lease,
    takenOver: acquisition.takenOver,
    recovered: acquisition.recovered,
    busyLease: null,
    attempts,
    waitUntil,
    admissionReason,
    heartbeatFailures,
  };
}
