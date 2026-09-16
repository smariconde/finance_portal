import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  addMilliseconds,
  decideItemAttempt,
  type IngestionJobItemDecision,
  type IngestionJobPlanInput,
  type IngestionLeaseHandle,
} from "@/modules/ingestion/domain/ingestion-job";

import {
  IngestionJobStateError,
  type IngestionJobStore,
} from "./ingestion-job-store";

/**
 * Contrato del almacén de jobs (ADR 0015), escrito una vez y corrido contra los
 * dos almacenes: el doble en memoria en la suite unitaria y PostgreSQL en la de
 * integración. Si un comportamiento sólo se prueba sobre uno, el otro puede
 * divergir sin que nada falle.
 *
 * Cada caso usa una fuente propia, así que la base de integración no necesita
 * vaciarse entre casos: el lease es por fuente y nada se cruza.
 */
export type IngestionJobStoreContractHarness = {
  readonly store: IngestionJobStore;
  /** Una corrida de ingesta existente a la que un item completo pueda apuntar. */
  readonly createIngestionRun: () => Promise<string>;
};

const T0 = "2026-09-16T12:00:00.000Z";
const TTL = 60_000;

export function at(offsetMs: number): string {
  return addMilliseconds(T0, offsetMs);
}

export function uniqueSourceId(): string {
  return `fixture-jobs-${randomUUID().slice(0, 8)}`;
}

export function planFor(
  sourceId: string,
  subjects: readonly string[],
  overrides: Partial<IngestionJobPlanInput> = {},
): IngestionJobPlanInput {
  return {
    kind: "sec_companyfacts_backfill",
    sourceId,
    datasetId: "sec.companyfacts",
    parserVersion: "fixture-1.0.0",
    selectionVersion: "fixture-selection-1.0.0",
    subjects: [...subjects],
    maxAttempts: 3,
    ...overrides,
  };
}

function complete(ingestionRunId: string): IngestionJobItemDecision {
  return decideItemAttempt(
    { kind: "ingested", ingestionRunId },
    { attempts: 1, maxAttempts: 3, now: T0 },
  );
}

export function describeIngestionJobStoreContract(
  label: string,
  createHarness: () =>
    | Promise<IngestionJobStoreContractHarness>
    | IngestionJobStoreContractHarness,
): void {
  describe(`ingestion job store contract (${label})`, () => {
    let store: IngestionJobStore;
    let createIngestionRun: () => Promise<string>;
    let sourceId: string;

    beforeEach(async () => {
      const harness = await createHarness();
      store = harness.store;
      createIngestionRun = harness.createIngestionRun;
      sourceId = uniqueSourceId();
    });

    async function openJob(
      subjects: readonly string[] = ["0000000001", "0000000002", "0000000003"],
      overrides: Partial<IngestionJobPlanInput> = {},
    ) {
      const { job } = await store.createJob(
        planFor(sourceId, subjects, overrides),
        {
          now: T0,
        },
      );

      return job;
    }

    async function acquire(jobId: string, holder: string, now: string) {
      const acquisition = await store.acquireLease({
        jobId,
        holder,
        leaseToken: randomUUID(),
        now,
        ttlMs: TTL,
      });

      if (acquisition.status !== "acquired") {
        throw new Error(`Expected to acquire, got ${acquisition.status}.`);
      }

      const { lease } = acquisition;
      const handle: IngestionLeaseHandle = {
        sourceId: lease.sourceId,
        jobId: lease.jobId,
        holder: lease.holder,
        leaseToken: lease.leaseToken,
      };

      return { acquisition, handle };
    }

    async function start(
      handle: IngestionLeaseHandle,
      ordinal: number,
      now: string,
    ) {
      const started = await store.startItem(handle, {
        ordinal,
        now,
        ttlMs: TTL,
      });

      if (started.status !== "ok") {
        throw new Error(`Expected to start, got ${started.status}.`);
      }

      return started;
    }

    async function eventTypes(jobId: string) {
      return (await store.listEvents({ jobId, limit: 500 })).map(
        (event) => event.eventType,
      );
    }

    describe("creación", () => {
      it("crea un item pendiente por sujeto, en orden, con el cursor en cero", async () => {
        const job = await openJob();
        const items = await store.listItems({ jobId: job.jobId });

        expect(job).toMatchObject({
          status: "open",
          cursor: 0,
          itemCount: 3,
          notBefore: null,
          finishedAt: null,
        });
        expect(
          items.map((item) => [item.ordinal, item.subjectKey, item.status]),
        ).toEqual([
          [0, "0000000001", "pending"],
          [1, "0000000002", "pending"],
          [2, "0000000003", "pending"],
        ]);
        expect(await store.countItems(job.jobId)).toEqual({
          pending: 3,
          running: 0,
          completed: 0,
          failed: 0,
          poisoned: 0,
        });
        expect(await eventTypes(job.jobId)).toEqual(["job_created"]);
      });

      it("devuelve el job abierto al pedir el mismo plan, aun con otro techo de intentos", async () => {
        const first = await openJob();
        const second = await store.createJob(
          planFor(sourceId, ["0000000001", "0000000002", "0000000003"], {
            maxAttempts: 7,
          }),
          { now: at(1000) },
        );

        expect(second.created).toBe(false);
        expect(second.job.jobId).toBe(first.jobId);
        expect(second.job.maxAttempts).toBe(3);
      });

      it("crea otro job si el plan cambia de orden o si el anterior ya terminó", async () => {
        const first = await openJob(["0000000001", "0000000002"]);
        const reordered = await store.createJob(
          planFor(sourceId, ["0000000002", "0000000001"]),
          { now: T0 },
        );

        expect(reordered.created).toBe(true);

        await store.cancelJob(first.jobId, {
          now: at(1),
          reason: "reemplazado",
        });
        const again = await store.createJob(
          planFor(sourceId, ["0000000001", "0000000002"]),
          { now: at(2) },
        );

        expect(again.created).toBe(true);
        expect(again.job.jobId).not.toBe(first.jobId);
      });

      it("rechaza un plan con un sujeto repetido", async () => {
        await expect(
          store.createJob(planFor(sourceId, ["0000000001", "0000000001"]), {
            now: T0,
          }),
        ).rejects.toThrow();
      });
    });

    describe("lease", () => {
      it("da la fuente a un solo holder hasta que el lease vence", async () => {
        const job = await openJob();
        const { acquisition } = await acquire(job.jobId, "worker-a", T0);

        expect(acquisition.takenOver).toBeNull();
        expect(acquisition.lease.expiresAt).toBe(at(TTL));

        const busy = await store.acquireLease({
          jobId: job.jobId,
          holder: "worker-b",
          leaseToken: randomUUID(),
          now: at(TTL - 1),
          ttlMs: TTL,
        });

        expect(busy.status).toBe("busy");
        expect(busy.status === "busy" && busy.lease.holder).toBe("worker-a");

        const { acquisition: takeover } = await acquire(
          job.jobId,
          "worker-b",
          at(TTL),
        );

        expect(takeover.takenOver?.holder).toBe("worker-a");
        expect(await eventTypes(job.jobId)).toEqual([
          "job_created",
          "lease_acquired",
          "lease_taken_over",
        ]);
      });

      it("excluye por fuente: otro job de la misma fuente espera y uno de otra fuente no", async () => {
        const first = await openJob(["0000000001"]);
        const second = await openJob(["0000000002"]);
        await acquire(first.jobId, "worker-a", T0);

        const sameSource = await store.acquireLease({
          jobId: second.jobId,
          holder: "worker-b",
          leaseToken: randomUUID(),
          now: at(1),
          ttlMs: TTL,
        });

        expect(sameSource.status).toBe("busy");

        const otherSource = await store.createJob(
          planFor(uniqueSourceId(), ["0000000001"]),
          { now: T0 },
        );
        const other = await store.acquireLease({
          jobId: otherSource.job.jobId,
          holder: "worker-b",
          leaseToken: randomUUID(),
          now: at(1),
          ttlMs: TTL,
        });

        expect(other.status).toBe("acquired");
      });

      it("no entrega la fuente a un job pausado", async () => {
        const job = await openJob();
        await store.pauseJob(job.jobId, {
          now: at(1),
          reason: "revisión manual",
        });

        const paused = await store.acquireLease({
          jobId: job.jobId,
          holder: "worker-a",
          leaseToken: randomUUID(),
          now: at(2),
          ttlMs: TTL,
        });

        expect(paused.status).toBe("job_not_runnable");
        expect(await store.getLease(sourceId)).toBeNull();
      });

      it("renueva con el latido y suelta sólo el lease propio", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        const renewed = await store.heartbeat(handle, {
          now: at(30_000),
          ttlMs: TTL,
        });

        expect(renewed?.expiresAt).toBe(at(30_000 + TTL));
        expect(
          await store.releaseLease(
            { ...handle, leaseToken: randomUUID() },
            { now: at(30_001) },
          ),
        ).toBe(false);
        expect(await store.getLease(sourceId)).not.toBeNull();
        expect(await store.releaseLease(handle, { now: at(30_002) })).toBe(
          true,
        );
        expect(await store.getLease(sourceId)).toBeNull();
      });

      it("un lease vencido sigue siendo del holder mientras nadie lo tome", async () => {
        const job = await openJob(["0000000001"]);
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        const runId = await createIngestionRun();

        const late = at(TTL * 3);
        const finished = await store.finishItem(handle, {
          ordinal: 0,
          decision: complete(runId),
          now: late,
          ttlMs: TTL,
        });

        expect(finished.status).toBe("ok");
        expect((await store.getLease(sourceId))?.expiresAt).toBe(
          addMilliseconds(late, TTL),
        );
      });
    });

    describe("cursor y checkpoint", () => {
      it("procesa en orden, avanza el cursor y completa el job con el último item", async () => {
        const job = await openJob(["0000000001", "0000000002"]);
        const { handle } = await acquire(job.jobId, "worker-a", T0);

        await expect(
          store.startItem(handle, { ordinal: 1, now: at(1), ttlMs: TTL }),
        ).rejects.toMatchObject({ code: "item_not_at_cursor" });

        const first = await start(handle, 0, at(1));

        expect(first.item).toMatchObject({
          status: "running",
          attempts: 1,
          leaseToken: handle.leaseToken,
          startedAt: at(1),
        });

        const runId = await createIngestionRun();
        const afterFirst = await store.finishItem(handle, {
          ordinal: 0,
          decision: complete(runId),
          now: at(2),
          ttlMs: TTL,
        });

        expect(afterFirst.status === "ok" && afterFirst.job.cursor).toBe(1);
        expect(afterFirst.status === "ok" && afterFirst.item).toMatchObject({
          status: "completed",
          ingestionRunId: runId,
          leaseToken: null,
          finishedAt: at(2),
        });

        await start(handle, 1, at(3));
        const afterLast = await store.finishItem(handle, {
          ordinal: 1,
          decision: complete(runId),
          now: at(4),
          ttlMs: TTL,
        });

        expect(afterLast.status === "ok" && afterLast.job).toMatchObject({
          status: "completed",
          cursor: 2,
          finishedAt: at(4),
        });
        expect((await store.peekNext(job.jobId)).item).toBeNull();
        expect(await eventTypes(job.jobId)).toEqual([
          "job_created",
          "lease_acquired",
          "item_started",
          "item_completed",
          "item_started",
          "item_completed",
          "job_completed",
        ]);
      });

      it("un reintento deja el cursor quieto y el item espera su backoff", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        const decision = decideItemAttempt(
          { kind: "executor_error", message: "boom" },
          { attempts: 1, maxAttempts: 3, now: at(2) },
        );

        const finished = await store.finishItem(handle, {
          ordinal: 0,
          decision,
          now: at(2),
          ttlMs: TTL,
        });

        expect(finished.status === "ok" && finished.job.cursor).toBe(0);
        expect(finished.status === "ok" && finished.item).toMatchObject({
          status: "pending",
          attempts: 1,
          notBefore: at(2 + 30_000),
          lastFailure: { code: "executor_error", retryable: true },
        });
        await expect(
          store.startItem(handle, { ordinal: 0, now: at(3), ttlMs: TTL }),
        ).rejects.toMatchObject({ code: "item_not_ready" });

        const retried = await start(handle, 0, at(2 + 30_000));
        expect(retried.item.attempts).toBe(2);
      });

      it("una señal de la fuente devuelve el intento y frena al job entero", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        const decision = decideItemAttempt(
          {
            kind: "source_signal",
            signal: "throttled",
            ingestionRunId: null,
            retryAfter: "120",
            message: "status 429",
          },
          { attempts: 1, maxAttempts: 3, now: at(2) },
        );

        const finished = await store.finishItem(handle, {
          ordinal: 0,
          decision,
          now: at(2),
          ttlMs: TTL,
        });

        expect(finished.status === "ok" && finished.item).toMatchObject({
          status: "pending",
          attempts: 0,
          notBefore: null,
          lastFailure: { code: "source_signal" },
        });
        expect(finished.status === "ok" && finished.job.notBefore).toBe(
          at(2 + 120_000),
        );

        const blocked = await store.startItem(handle, {
          ordinal: 0,
          now: at(3),
          ttlMs: TTL,
        });
        expect(blocked.status).toBe("job_not_runnable");
        expect(await eventTypes(job.jobId)).toContain("job_backoff");

        await store.releaseLease(handle, { now: at(4) });
        const waiting = await store.acquireLease({
          jobId: job.jobId,
          holder: "worker-b",
          leaseToken: randomUUID(),
          now: at(2 + 120_000 - 1),
          ttlMs: TTL,
        });

        expect(waiting.status).toBe("job_not_runnable");
        expect(
          (
            await store.acquireLease({
              jobId: job.jobId,
              holder: "worker-b",
              leaseToken: randomUUID(),
              now: at(2 + 120_000),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("acquired");
      });

      it("un item fallado sin reintento es terminal y el cursor lo pasa", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        const runId = await createIngestionRun();

        const finished = await store.finishItem(handle, {
          ordinal: 0,
          decision: decideItemAttempt(
            {
              kind: "ingestion_failed",
              ingestionRunId: runId,
              retryable: false,
              message:
                "SEC companyfacts failed with unexpected_status: status 404.",
            },
            { attempts: 1, maxAttempts: 3, now: at(2) },
          ),
          now: at(2),
          ttlMs: TTL,
        });

        expect(finished.status === "ok" && finished.item).toMatchObject({
          status: "failed",
          ingestionRunId: runId,
          lastFailure: { code: "ingestion_failed", retryable: false },
        });
        expect(finished.status === "ok" && finished.job.cursor).toBe(1);
      });
    });

    describe("vencimiento y recuperación", () => {
      it("el nuevo dueño recupera el intento huérfano y el viejo ya no puede escribir", async () => {
        const job = await openJob();
        const { handle: first } = await acquire(job.jobId, "worker-a", T0);
        await start(first, 0, at(1));

        const { acquisition, handle: second } = await acquire(
          job.jobId,
          "worker-b",
          at(TTL + 1),
        );

        expect(acquisition.recovered).toHaveLength(1);
        expect(acquisition.recovered[0]).toMatchObject({
          ordinal: 0,
          status: "pending",
          attempts: 1,
          leaseToken: null,
          lastFailure: { code: "lease_expired" },
        });

        const runId = await createIngestionRun();
        expect(
          await store.heartbeat(first, { now: at(TTL + 2), ttlMs: TTL }),
        ).toBeNull();
        expect(
          (
            await store.finishItem(first, {
              ordinal: 0,
              decision: complete(runId),
              now: at(TTL + 2),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("lease_lost");
        expect(
          (
            await store.startItem(first, {
              ordinal: 0,
              now: at(TTL + 2),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("lease_lost");
        expect(await store.releaseLease(first, { now: at(TTL + 3) })).toBe(
          false,
        );
        expect((await store.getLease(sourceId))?.holder).toBe("worker-b");

        const retried = await start(second, 0, at(TTL + 4));
        expect(retried.item.attempts).toBe(2);
        expect(await eventTypes(job.jobId)).toEqual([
          "job_created",
          "lease_acquired",
          "item_started",
          "lease_taken_over",
          "item_recovered",
          "item_started",
        ]);
      });

      it("envenena al sujeto que tumba al proceso en cada intento y sigue con el próximo", async () => {
        const job = await openJob(["0000000001", "0000000002"], {
          maxAttempts: 2,
        });
        const { handle: first } = await acquire(job.jobId, "worker-a", T0);
        await start(first, 0, at(1));
        const { handle: second } = await acquire(
          job.jobId,
          "worker-b",
          at(TTL + 1),
        );
        await start(second, 0, at(TTL + 2));

        const { acquisition } = await acquire(
          job.jobId,
          "worker-c",
          at(3 * TTL),
        );

        expect(acquisition.recovered[0]).toMatchObject({
          ordinal: 0,
          status: "poisoned",
          attempts: 2,
          finishedAt: at(3 * TTL),
          lastFailure: { code: "lease_expired" },
        });
        expect(acquisition.job.cursor).toBe(1);
        expect((await store.peekNext(job.jobId)).item?.ordinal).toBe(1);
        expect(await eventTypes(job.jobId)).toContain("item_poisoned");
      });

      it("recupera huérfanos de otro job de la misma fuente", async () => {
        const abandoned = await openJob(["0000000001"]);
        const next = await openJob(["0000000002"]);
        const { handle } = await acquire(abandoned.jobId, "worker-a", T0);
        await start(handle, 0, at(1));

        const { acquisition } = await acquire(
          next.jobId,
          "worker-b",
          at(TTL + 1),
        );

        expect(acquisition.recovered.map((item) => item.jobId)).toEqual([
          abandoned.jobId,
        ]);
        expect(
          (await store.listItems({ jobId: abandoned.jobId }))[0]?.status,
        ).toBe("pending");
      });

      it("liberar a la fuerza recupera el intento y deja la razón en la bitácora", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));

        const forced = await store.forceReleaseLease(sourceId, {
          now: at(2),
          reason: "el proceso murió con kill -9",
        });

        expect(forced.released?.holder).toBe("worker-a");
        expect(forced.recovered.map((item) => item.status)).toEqual([
          "pending",
        ]);
        expect(await store.getLease(sourceId)).toBeNull();

        const runId = await createIngestionRun();
        expect(
          (
            await store.finishItem(handle, {
              ordinal: 0,
              decision: complete(runId),
              now: at(3),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("lease_lost");

        const events = await store.listEvents({ jobId: job.jobId });
        const released = events.find(
          (event) => event.eventType === "lease_force_released",
        );

        expect(released).toMatchObject({
          actor: "owner",
          leaseToken: handle.leaseToken,
          detail: {
            reason: "el proceso murió con kill -9",
            holder: "worker-a",
          },
        });
        expect(events.map((event) => event.sequence)).toEqual(
          [...events.map((event) => event.sequence)].sort((a, b) => a - b),
        );
      });
    });

    describe("recuperación manual", () => {
      it("una pausa deja terminar el intento en curso y frena el siguiente", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        await store.pauseJob(job.jobId, {
          now: at(2),
          reason: "revisar un 404",
        });
        const runId = await createIngestionRun();

        const finished = await store.finishItem(handle, {
          ordinal: 0,
          decision: complete(runId),
          now: at(3),
          ttlMs: TTL,
        });

        expect(finished.status === "ok" && finished.job).toMatchObject({
          status: "paused",
          cursor: 1,
          statusReason: "revisar un 404",
        });
        expect(
          (
            await store.startItem(handle, {
              ordinal: 1,
              now: at(4),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("job_not_runnable");

        await expect(
          store.pauseJob(job.jobId, { now: at(5), reason: "otra vez" }),
        ).rejects.toBeInstanceOf(IngestionJobStateError);

        const resumed = await store.resumeJob(job.jobId, {
          now: at(6),
          reason: "404 entendido",
        });
        expect(resumed.status).toBe("open");
      });

      it("reanudar levanta el backoff de la fuente y se niega si no hay nada que reanudar", async () => {
        const job = await openJob();
        await expect(
          store.resumeJob(job.jobId, { now: at(1), reason: "nada" }),
        ).rejects.toMatchObject({ code: "job_not_paused" });

        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        await store.finishItem(handle, {
          ordinal: 0,
          decision: decideItemAttempt(
            {
              kind: "source_signal",
              signal: "refused",
              ingestionRunId: null,
              retryAfter: null,
              message: "status 403",
            },
            { attempts: 1, maxAttempts: 3, now: at(2) },
          ),
          now: at(2),
          ttlMs: TTL,
        });

        const resumed = await store.resumeJob(job.jobId, {
          now: at(3),
          reason: "User-Agent corregido",
        });

        expect(resumed).toMatchObject({ status: "open", notBefore: null });
        const events = await store.listEvents({ jobId: job.jobId });
        expect(events.at(-1)?.detail).toMatchObject({
          previousStatus: "open",
          previousNotBefore: at(2 + 10 * 60_000),
        });
      });

      it("cancelar se niega mientras el job tiene el lease y es definitivo", async () => {
        const job = await openJob();
        const { handle } = await acquire(job.jobId, "worker-a", T0);

        await expect(
          store.cancelJob(job.jobId, {
            now: at(1),
            reason: "ya no hace falta",
          }),
        ).rejects.toMatchObject({ code: "job_leased" });

        await store.releaseLease(handle, { now: at(2) });
        const cancelled = await store.cancelJob(job.jobId, {
          now: at(3),
          reason: "ya no hace falta",
        });

        expect(cancelled).toMatchObject({
          status: "cancelled",
          finishedAt: at(3),
          cursor: 0,
        });
        await expect(
          store.cancelJob(job.jobId, { now: at(4), reason: "de nuevo" }),
        ).rejects.toMatchObject({ code: "job_terminal" });
        expect(
          (
            await store.acquireLease({
              jobId: job.jobId,
              holder: "worker-a",
              leaseToken: randomUUID(),
              now: at(5),
              ttlMs: TTL,
            })
          ).status,
        ).toBe("job_not_runnable");
      });

      it("reencolar un item envenenado vuelve el cursor atrás y reabre un job completado", async () => {
        const job = await openJob(["0000000001", "0000000002"], {
          maxAttempts: 1,
        });
        const { handle } = await acquire(job.jobId, "worker-a", T0);
        await start(handle, 0, at(1));
        await store.finishItem(handle, {
          ordinal: 0,
          decision: decideItemAttempt(
            { kind: "executor_error", message: "boom" },
            { attempts: 1, maxAttempts: 1, now: at(2) },
          ),
          now: at(2),
          ttlMs: TTL,
        });
        await start(handle, 1, at(3));
        const runId = await createIngestionRun();
        const done = await store.finishItem(handle, {
          ordinal: 1,
          decision: complete(runId),
          now: at(4),
          ttlMs: TTL,
        });

        expect(done.status === "ok" && done.job.status).toBe("completed");

        await expect(
          store.requeueItem(job.jobId, 1, { now: at(5), reason: "no aplica" }),
        ).rejects.toMatchObject({ code: "item_not_requeueable" });

        const requeued = await store.requeueItem(job.jobId, 0, {
          now: at(6),
          reason: "parser corregido",
        });

        expect(requeued.item).toMatchObject({
          status: "pending",
          attempts: 0,
          finishedAt: null,
          lastFailure: { code: "executor_error" },
        });
        expect(requeued.job).toMatchObject({
          status: "open",
          cursor: 0,
          finishedAt: null,
        });
        expect((await eventTypes(job.jobId)).slice(-2)).toEqual([
          "item_requeued",
          "job_reopened",
        ]);
      });

      it("redacta el motivo antes de guardarlo", async () => {
        const job = await openJob();
        const paused = await store.pauseJob(job.jobId, {
          now: at(1),
          reason: "rotar token=abc123 antes de seguir",
        });

        expect(paused.statusReason).toBe(
          "rotar token=[redacted] antes de seguir",
        );
      });
    });
  });
}
