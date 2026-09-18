import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMilliseconds,
  INGESTION_JOB_POLICY,
  type IngestionJobAttemptOutcome,
  type IngestionJobItem,
} from "@/modules/ingestion/domain/ingestion-job";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";

import { planFor, uniqueSourceId } from "./ingestion-job-store.contract";
import {
  runIngestionJob,
  type IngestionJobExecutor,
  type RunIngestionJobDependencies,
} from "./run-ingestion-job";

const T0 = "2026-09-16T12:00:00.000Z";
const TTL = INGESTION_JOB_POLICY.leaseTtlMs;

/** Reloj de test: avanza sólo cuando alguien espera o lo mueve a mano. */
function createClock() {
  let current = T0;

  return {
    now: () => current,
    advance: (ms: number) => {
      current = addMilliseconds(current, ms);
    },
    sleep: vi.fn(async (ms: number) => {
      current = addMilliseconds(current, ms);
    }),
  };
}

function createHeartbeat() {
  let beat: (() => Promise<void>) | null = null;
  const stop = vi.fn(() => {
    beat = null;
  });

  return {
    start: vi.fn((callback: () => Promise<void>) => {
      beat = callback;
      return stop;
    }),
    stop,
    trigger: async () => {
      await beat?.();
    },
  };
}

const ingested = (): IngestionJobAttemptOutcome => ({
  kind: "ingested",
  ingestionRunId: randomUUID(),
});

describe("runIngestionJob", () => {
  let store: ReturnType<typeof createInMemoryIngestionJobStore>;
  let clock: ReturnType<typeof createClock>;
  let heartbeat: ReturnType<typeof createHeartbeat>;
  let sourceId: string;

  beforeEach(() => {
    store = createInMemoryIngestionJobStore({ newId: randomUUID });
    clock = createClock();
    heartbeat = createHeartbeat();
    sourceId = uniqueSourceId();
  });

  async function createJob(subjects: readonly string[], maxAttempts = 3) {
    const { job } = await store.createJob(
      planFor(sourceId, subjects, { maxAttempts }),
      { now: T0 },
    );

    return job;
  }

  function dependencies(
    execute: IngestionJobExecutor,
    overrides: Partial<RunIngestionJobDependencies> = {},
  ): RunIngestionJobDependencies {
    return {
      store,
      execute,
      now: clock.now,
      sleep: clock.sleep,
      newLeaseToken: randomUUID,
      startHeartbeat: heartbeat.start,
      ...overrides,
    };
  }

  it("procesa todo el plan en orden, completa el job y suelta el lease", async () => {
    const job = await createJob(["A", "B", "C"]);
    const seen: string[] = [];
    const execute = vi.fn(async (item: IngestionJobItem) => {
      seen.push(item.subjectKey);
      clock.advance(1000);
      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("completed");
    expect(seen).toEqual(["A", "B", "C"]);
    expect(result.job).toMatchObject({ status: "completed", cursor: 3 });
    expect(result.attempts.map((attempt) => attempt.decision.kind)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    expect(await store.getLease(sourceId)).toBeNull();
    expect(heartbeat.start).toHaveBeenCalledWith(
      expect.any(Function),
      INGESTION_JOB_POLICY.heartbeatIntervalMs,
    );
    expect(heartbeat.stop).toHaveBeenCalledOnce();

    const events = await store.listEvents({ jobId: job.jobId, limit: 100 });
    expect(events.at(-1)?.eventType).toBe("lease_released");
    expect(events.map((event) => event.eventType)).toContain("job_completed");
  });

  it("se detiene en el techo de intentos y la corrida siguiente sigue desde el cursor", async () => {
    const job = await createJob(["A", "B", "C"]);
    const execute = vi.fn(async () => ingested());

    const first = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a", attemptLimit: 2 },
      dependencies(execute),
    );

    expect(first.stopReason).toBe("attempt_limit");
    expect(first.job.cursor).toBe(2);
    expect(await store.getLease(sourceId)).toBeNull();

    const second = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-b" },
      dependencies(execute),
    );

    expect(second.stopReason).toBe("completed");
    expect(second.attempts.map((attempt) => attempt.subjectKey)).toEqual(["C"]);
    expect(second.takenOver).toBeNull();
  });

  it("no empieza un item si el presupuesto de la corrida no lo cubre", async () => {
    const job = await createJob(["A", "B"]);
    let remaining = 1;
    const execute = vi.fn(async () => {
      remaining -= 1;
      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute, {
        admitItem: () =>
          remaining > 0 ? { status: "ready" } : { status: "budget_reserve" },
      }),
    );

    expect(result.stopReason).toBe("budget_reserve");
    expect(execute).toHaveBeenCalledOnce();
    expect(result.job.cursor).toBe(1);
    expect((await store.peekNext(job.jobId)).item).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("no empieza un item con la fuente frenada, y nombra el motivo", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async () => ingested());

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute, {
        admitItem: () => ({
          status: "source_disabled",
          reason: "sondeo manual en curso",
        }),
      }),
    );

    expect(result.stopReason).toBe("source_disabled");
    expect(result.admissionReason).toBe("sondeo manual en curso");
    // Nada empezó: una decisión del owner no gasta intentos ni envenena sujetos.
    expect(execute).not.toHaveBeenCalled();
    expect(result.job.cursor).toBe(0);
    expect((await store.peekNext(job.jobId)).item).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("no empieza un item sin cuota del día, y dice cuándo se repone", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async () => ingested());

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute, {
        admitItem: () => ({
          status: "daily_budget_exhausted",
          resumesAt: "2026-09-19T00:00:00.000Z",
        }),
      }),
    );

    expect(result.stopReason).toBe("daily_budget_exhausted");
    expect(result.waitUntil).toBe("2026-09-19T00:00:00.000Z");
    expect(execute).not.toHaveBeenCalled();
    expect((await store.peekNext(job.jobId)).item).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("una interrupción termina el item en curso y suelta el lease", async () => {
    const job = await createJob(["A", "B"]);
    let interrupted = false;
    const execute = vi.fn(async () => {
      interrupted = true;
      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute, { shouldStop: () => interrupted }),
    );

    expect(result.stopReason).toBe("interrupted");
    expect(execute).toHaveBeenCalledOnce();
    expect(result.job.cursor).toBe(1);
    expect(await store.getLease(sourceId)).toBeNull();
  });

  it("no ejecuta nada si otro proceso vivo tiene la fuente", async () => {
    const job = await createJob(["A"]);
    await store.acquireLease({
      jobId: job.jobId,
      holder: "worker-other",
      leaseToken: randomUUID(),
      now: T0,
      ttlMs: TTL,
    });
    const execute = vi.fn(async () => ingested());

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("source_busy");
    expect(result.busyLease?.holder).toBe("worker-other");
    expect(result.lease).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(heartbeat.start).not.toHaveBeenCalled();
    expect((await store.getLease(sourceId))?.holder).toBe("worker-other");
  });

  it("retoma después de un proceso muerto: recupera el item y lo vuelve a intentar", async () => {
    const job = await createJob(["A", "B"]);
    const crashed = await store.acquireLease({
      jobId: job.jobId,
      holder: "worker-dead",
      leaseToken: randomUUID(),
      now: T0,
      ttlMs: TTL,
    });

    if (crashed.status !== "acquired") {
      throw new Error("setup failed");
    }

    await store.startItem(crashed.lease, { ordinal: 0, now: T0, ttlMs: TTL });
    clock.advance(TTL);
    const execute = vi.fn(async () => ingested());

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("completed");
    expect(result.takenOver?.holder).toBe("worker-dead");
    expect(result.recovered.map((item) => item.subjectKey)).toEqual(["A"]);
    expect(result.attempts[0]).toMatchObject({ subjectKey: "A", attempt: 2 });
  });

  it("una excepción del ejecutor se reintenta con espera y termina envenenada en el techo", async () => {
    const job = await createJob(["A", "B"], 3);
    const execute = vi.fn(async (item: IngestionJobItem) => {
      if (item.subjectKey === "A") {
        throw new TypeError("Cannot read properties of undefined");
      }

      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("completed");
    expect(
      result.attempts.map((attempt) => [
        attempt.subjectKey,
        attempt.decision.kind,
      ]),
    ).toEqual([
      ["A", "retry"],
      ["A", "retry"],
      ["A", "poison"],
      ["B", "complete"],
    ]);
    // 30 s y 2 min: las dos esperas se hicieron con el lease tomado.
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([30_000, 120_000]);
    expect(result.attempts[0]?.outcome).toMatchObject({
      kind: "executor_error",
      message: "TypeError: Cannot read properties of undefined",
    });

    const [poisoned] = await store.listItems({
      jobId: job.jobId,
      statuses: ["poisoned"],
    });
    expect(poisoned).toMatchObject({ subjectKey: "A", attempts: 3 });
  });

  it("nombra la causa más interna de una excepción envuelta", async () => {
    const job = await createJob(["A"], 1);
    const execute = vi.fn(async () => {
      const driver = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "ingestion_runs_publishable_idempotency_uidx"',
        ),
        { name: "PostgresError" },
      );

      throw Object.assign(
        new Error(
          `Failed query: insert into "ingestion_runs" ${"(x) ".repeat(80)}`,
          {
            cause: driver,
          },
        ),
        { name: "DrizzleQueryError" },
      );
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    // La redacción de `TM-02` tapa el identificador largo; el motivo queda.
    expect(result.attempts[0]?.outcome).toEqual({
      kind: "executor_error",
      message:
        'DrizzleQueryError ← PostgresError: duplicate key value violates unique constraint "[redacted]"',
    });
  });

  it("suelta el lease en vez de esperar un backoff más largo que el tolerable", async () => {
    const job = await createJob(["A"], 5);
    const policy = { ...INGESTION_JOB_POLICY, maxInlineWaitMs: 60_000 };
    const execute = vi.fn(async (): Promise<IngestionJobAttemptOutcome> => ({
      kind: "executor_error",
      message: "boom",
    }));

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute, { policy }),
    );

    // 30 s se espera; 2 min ya no.
    expect(result.stopReason).toBe("item_backoff");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.waitUntil).toBe(addMilliseconds(clock.now(), 120_000));
    expect(await store.getLease(sourceId)).toBeNull();
  });

  it("una señal de la fuente frena la corrida sin gastar el intento, y el job espera", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async (): Promise<IngestionJobAttemptOutcome> => ({
      kind: "source_signal",
      signal: "throttled",
      ingestionRunId: null,
      retryAfter: null,
      message: "status 429",
    }));

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("source_signal");
    expect(result.waitUntil).toBe(addMilliseconds(T0, 10 * 60_000));
    expect((await store.peekNext(job.jobId)).item).toMatchObject({
      subjectKey: "A",
      attempts: 0,
    });

    clock.advance(60_000);
    const early = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(early.stopReason).toBe("job_not_runnable");
    expect(early.waitUntil).toBe(result.waitUntil);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("una señal breve de la fuente se espera con el lease tomado y la corrida sigue", async () => {
    const job = await createJob(["A", "B"]);
    let calls = 0;
    const execute = vi.fn(async (): Promise<IngestionJobAttemptOutcome> => {
      calls += 1;

      return calls === 1
        ? {
            kind: "source_signal",
            signal: "unavailable",
            ingestionRunId: null,
            retryAfter: null,
            message: "transport_error",
          }
        : ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("completed");
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000]);
    expect(
      result.attempts.map((attempt) => [
        attempt.subjectKey,
        attempt.attempt,
        attempt.decision.kind,
      ]),
    ).toEqual([
      ["A", 1, "defer"],
      ["A", 1, "complete"],
      ["B", 1, "complete"],
    ]);
    expect(result.takenOver).toBeNull();
    const events = await store.listEvents({ jobId: job.jobId, limit: 100 });
    expect(
      events.filter((event) => event.eventType === "lease_acquired"),
    ).toHaveLength(1);
  });

  it("tres señales seguidas frenan la corrida aunque cada espera sea breve", async () => {
    const job = await createJob(["A"]);
    const execute = vi.fn(async (): Promise<IngestionJobAttemptOutcome> => ({
      kind: "source_signal",
      signal: "unavailable",
      ingestionRunId: null,
      retryAfter: null,
      message: "address_unresolvable",
    }));

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("source_signal");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
    expect(result.waitUntil).toBe(addMilliseconds(clock.now(), 60_000));
    expect((await store.peekNext(job.jobId)).item?.attempts).toBe(0);
    expect(await store.getLease(sourceId)).toBeNull();
  });

  it("el latido mantiene el lease durante un intento más largo que el TTL", async () => {
    const job = await createJob(["A"]);
    const execute = vi.fn(async () => {
      for (let minute = 0; minute < 12; minute += 1) {
        clock.advance(60_000);
        await heartbeat.trigger();
      }

      const intruder = await store.acquireLease({
        jobId: job.jobId,
        holder: "worker-b",
        leaseToken: randomUUID(),
        now: clock.now(),
        ttlMs: TTL,
      });
      expect(intruder.status).toBe("busy");

      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("completed");
    expect(result.heartbeatFailures).toBe(0);
  });

  it("si otro toma la fuente durante el intento, el resultado no se escribe y el lease ajeno no se suelta", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async () => {
      clock.advance(TTL + 1);
      const intruder = await store.acquireLease({
        jobId: job.jobId,
        holder: "worker-b",
        leaseToken: randomUUID(),
        now: clock.now(),
        ttlMs: TTL,
      });
      expect(intruder.status).toBe("acquired");

      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("lease_lost");
    expect(result.attempts).toEqual([]);
    expect((await store.getLease(sourceId))?.holder).toBe("worker-b");
    expect((await store.peekNext(job.jobId)).item).toMatchObject({
      subjectKey: "A",
      status: "pending",
      lastFailure: { code: "lease_expired" },
    });
  });

  it("un latido rechazado frena antes del próximo item", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async () => {
      await store.forceReleaseLease(sourceId, {
        now: clock.now(),
        reason: "prueba de kill manual",
      });
      await heartbeat.trigger();
      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("lease_lost");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("una pausa del owner deja terminar el item en curso y frena el siguiente", async () => {
    const job = await createJob(["A", "B"]);
    const execute = vi.fn(async () => {
      await store.pauseJob(job.jobId, {
        now: clock.now(),
        reason: "pausa del owner",
      });
      return ingested();
    });

    const result = await runIngestionJob(
      { jobId: job.jobId, holder: "worker-a" },
      dependencies(execute),
    );

    expect(result.stopReason).toBe("job_not_runnable");
    expect(result.job).toMatchObject({ status: "paused", cursor: 1 });
    expect(await store.getLease(sourceId)).toBeNull();
  });

  it("si el almacén falla, suelta el lease y propaga el error original", async () => {
    const job = await createJob(["A"]);
    const failing = {
      ...store,
      finishItem: vi.fn(async () => {
        throw new Error("connection terminated");
      }),
    };
    const execute = vi.fn(async () => ingested());

    await expect(
      runIngestionJob(
        { jobId: job.jobId, holder: "worker-a" },
        dependencies(execute, { store: failing }),
      ),
    ).rejects.toThrow("connection terminated");
    expect(heartbeat.stop).toHaveBeenCalled();
    expect(await store.getLease(sourceId)).toBeNull();
    // El item quedó `running`: el próximo worker lo recupera como huérfano.
    expect((await store.peekNext(job.jobId)).item?.status).toBe("running");
  });

  it("rechaza un holder que no es un identificador", async () => {
    const job = await createJob(["A"]);

    await expect(
      runIngestionJob(
        { jobId: job.jobId, holder: "worker a; drop table" },
        dependencies(vi.fn()),
      ),
    ).rejects.toThrow();
  });
});
