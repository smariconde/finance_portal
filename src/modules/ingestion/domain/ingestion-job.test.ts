import { describe, expect, it } from "vitest";

import {
  computeIngestionJobPlanHash,
  computeJobCursor,
  computeRetryBackoffMs,
  computeSourceBackoffMs,
  decideItemAttempt,
  decideOrphanRecovery,
  INGESTION_JOB_POLICY,
  ingestionJobEventDetailSchema,
  ingestionJobItemSchema,
  ingestionJobPlanSchema,
  ingestionJobReasonSchema,
  ingestionJobSchema,
  ingestionLeaseSchema,
  isLeaseExpired,
  parseRetryAfterMs,
} from "./ingestion-job";
import {
  advanceJob,
  applyItemDecision,
  IngestionJobTransitionError,
  reopenJob,
  requeueItemState,
  startItemAttempt,
} from "./ingestion-job-transitions";

const T0 = "2026-09-16T12:00:00.000Z";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";

function plan(overrides: Record<string, unknown> = {}) {
  return ingestionJobPlanSchema.parse({
    kind: "sec_companyfacts_backfill",
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    parserVersion: "sec-companyfacts-1.0.0",
    selectionVersion: "sec-core-concepts-1.0.0",
    subjects: ["0000320193", "0000789019"],
    ...overrides,
  });
}

function job(overrides: Record<string, unknown> = {}) {
  return ingestionJobSchema.parse({
    jobId: JOB_ID,
    kind: "sec_companyfacts_backfill",
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    parserVersion: "sec-companyfacts-1.0.0",
    selectionVersion: "sec-core-concepts-1.0.0",
    planHash: "a".repeat(64),
    itemCount: 2,
    maxAttempts: 3,
    status: "open",
    cursor: 0,
    notBefore: null,
    statusReason: null,
    createdAt: T0,
    updatedAt: T0,
    finishedAt: null,
    ...overrides,
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return ingestionJobItemSchema.parse({
    jobId: JOB_ID,
    ordinal: 0,
    subjectKey: "0000320193",
    status: "pending",
    attempts: 0,
    notBefore: null,
    leaseToken: null,
    startedAt: null,
    finishedAt: null,
    ingestionRunId: null,
    lastFailure: null,
    updatedAt: T0,
    ...overrides,
  });
}

const failure = {
  code: "executor_error" as const,
  message: "boom",
  retryable: true,
};

describe("ingestionJobPlanSchema", () => {
  it("usa tres intentos por defecto y rechaza sujetos repetidos o un plan vacío", () => {
    expect(plan().maxAttempts).toBe(3);
    expect(() => plan({ subjects: ["0000320193", "0000320193"] })).toThrow();
    expect(() => plan({ subjects: [] })).toThrow();
    expect(() => plan({ maxAttempts: 0 })).toThrow();
  });

  it("el hash nombra el trabajo: depende del orden y no del techo de intentos", () => {
    const base = computeIngestionJobPlanHash(plan());

    expect(computeIngestionJobPlanHash(plan({ maxAttempts: 9 }))).toBe(base);
    expect(
      computeIngestionJobPlanHash(
        plan({ subjects: ["0000789019", "0000320193"] }),
      ),
    ).not.toBe(base);
    expect(
      computeIngestionJobPlanHash(plan({ selectionVersion: null })),
    ).not.toBe(base);
  });
});

describe("ingestionJobSchema", () => {
  it("un job abierto siempre tiene un item por delante y uno completo ninguno", () => {
    expect(() => job({ cursor: 2 })).toThrow();
    expect(() =>
      job({ cursor: 3, status: "cancelled", finishedAt: T0 }),
    ).toThrow();
    expect(() =>
      job({ status: "completed", finishedAt: T0, cursor: 1 }),
    ).toThrow();
    expect(job({ status: "completed", finishedAt: T0, cursor: 2 }).status).toBe(
      "completed",
    );
    expect(job({ status: "cancelled", finishedAt: T0, cursor: 0 }).cursor).toBe(
      0,
    );
  });

  it("finishedAt existe exactamente para los estados terminales", () => {
    expect(() => job({ finishedAt: T0 })).toThrow();
    expect(() => job({ status: "cancelled" })).toThrow();
  });
});

describe("ingestionJobItemSchema", () => {
  it("sólo un item en curso lleva token y sólo uno terminal lleva finishedAt", () => {
    expect(() => item({ status: "running" })).toThrow();
    expect(() => item({ leaseToken: TOKEN })).toThrow();
    expect(() => item({ status: "running", leaseToken: TOKEN })).toThrow();
    expect(
      item({ status: "running", leaseToken: TOKEN, startedAt: T0, attempts: 1 })
        .status,
    ).toBe("running");
    expect(() =>
      item({ status: "completed", ingestionRunId: RUN_ID }),
    ).toThrow();
  });

  it("un item completo apunta a su corrida y uno fallado dice por qué", () => {
    expect(() => item({ status: "completed", finishedAt: T0 })).toThrow();
    expect(() => item({ status: "failed", finishedAt: T0 })).toThrow();
    expect(() => item({ status: "pending", attempts: 1 })).toThrow();
    expect(() =>
      item({
        status: "failed",
        finishedAt: T0,
        notBefore: T0,
        lastFailure: failure,
      }),
    ).toThrow();
  });
});

describe("lease", () => {
  const lease = (overrides: Record<string, unknown> = {}) =>
    ingestionLeaseSchema.parse({
      sourceId: "sec-edgar",
      jobId: JOB_ID,
      holder: "host/1234/abcd",
      leaseToken: TOKEN,
      acquiredAt: T0,
      heartbeatAt: T0,
      expiresAt: "2026-09-16T12:05:00.000Z",
      ...overrides,
    });

  it("vence exactamente en expiresAt", () => {
    expect(isLeaseExpired(lease(), "2026-09-16T12:04:59.999Z")).toBe(false);
    expect(isLeaseExpired(lease(), "2026-09-16T12:05:00.000Z")).toBe(true);
  });

  it("rechaza una línea de tiempo imposible y un holder con espacios", () => {
    expect(() => lease({ expiresAt: T0 })).toThrow();
    expect(() => lease({ heartbeatAt: "2026-09-16T11:59:59.000Z" })).toThrow();
    expect(() => lease({ holder: "host 1" })).toThrow();
  });
});

describe("backoff", () => {
  it("reintenta a los 30 s, 2 min y 8 min, con techo", () => {
    expect(
      [1, 2, 3, 4, 10].map((attempt) => computeRetryBackoffMs(attempt)),
    ).toEqual([30_000, 120_000, 480_000, 900_000, 900_000]);
  });

  it("lee Retry-After en segundos o como fecha, y descarta lo que no entiende", () => {
    expect(parseRetryAfterMs("120", T0)).toBe(120_000);
    expect(parseRetryAfterMs(" 0 ", T0)).toBe(0);
    expect(parseRetryAfterMs("Wed, 16 Sep 2026 12:02:00 GMT", T0)).toBe(
      120_000,
    );
    expect(parseRetryAfterMs("Wed, 16 Sep 2026 11:00:00 GMT", T0)).toBe(0);
    expect(parseRetryAfterMs("-5", T0)).toBeNull();
    expect(parseRetryAfterMs("1.5", T0)).toBeNull();
    expect(parseRetryAfterMs("soon", T0)).toBeNull();
    expect(parseRetryAfterMs("", T0)).toBeNull();
    expect(parseRetryAfterMs(null, T0)).toBeNull();
  });

  it("acota la espera de la fuente y usa el default de cada señal", () => {
    expect(computeSourceBackoffMs("throttled", null, T0)).toBe(600_000);
    expect(computeSourceBackoffMs("unavailable", null, T0)).toBe(60_000);
    expect(computeSourceBackoffMs("throttled", "0", T0)).toBe(
      INGESTION_JOB_POLICY.minSourceBackoffMs,
    );
    expect(computeSourceBackoffMs("throttled", "86400", T0)).toBe(
      INGESTION_JOB_POLICY.maxSourceBackoffMs,
    );
    expect(computeSourceBackoffMs("refused", "900", T0)).toBe(900_000);
  });
});

describe("decideItemAttempt", () => {
  const context = { attempts: 1, maxAttempts: 3, now: T0 };

  it("una corrida registrada completa el item, aunque haya quedado en cuarentena", () => {
    expect(
      decideItemAttempt({ kind: "ingested", ingestionRunId: RUN_ID }, context),
    ).toEqual({ kind: "complete", ingestionRunId: RUN_ID });
  });

  it("una corrida fallida reintentable espera; una que no lo es termina", () => {
    const outcome = {
      kind: "ingestion_failed" as const,
      ingestionRunId: RUN_ID,
      message: "SEC companyfacts failed with unexpected_status: status 502.",
    };

    expect(
      decideItemAttempt({ ...outcome, retryable: true }, context),
    ).toMatchObject({
      kind: "retry",
      ingestionRunId: RUN_ID,
      notBefore: "2026-09-16T12:00:30.000Z",
      failure: { code: "ingestion_failed", retryable: true },
    });
    expect(
      decideItemAttempt({ ...outcome, retryable: false }, context),
    ).toMatchObject({
      kind: "fail",
      failure: { code: "ingestion_failed", retryable: false },
    });
    expect(
      decideItemAttempt(
        { ...outcome, retryable: true },
        { ...context, attempts: 3 },
      ),
    ).toMatchObject({ kind: "poison" });
  });

  it("un sujeto rechazado falla en el primer intento y sin corrida", () => {
    expect(
      decideItemAttempt(
        { kind: "subject_rejected", message: "no CIK" },
        context,
      ),
    ).toMatchObject({
      kind: "fail",
      ingestionRunId: null,
      failure: { code: "subject_rejected", retryable: false },
    });
  });

  it("una excepción se reintenta hasta el techo y el mensaje se redacta", () => {
    const decision = decideItemAttempt(
      {
        kind: "executor_error",
        message: "failed for postgres://owner:secret@db/finance",
      },
      { ...context, attempts: 3 },
    );

    expect(decision).toMatchObject({ kind: "poison" });
    expect(decision.kind !== "complete" && decision.failure.message).toBe(
      "failed for postgres://[redacted]@db/finance",
    );
  });

  it("una señal de la fuente difiere sin importar cuántos intentos van", () => {
    expect(
      decideItemAttempt(
        {
          kind: "source_signal",
          signal: "unavailable",
          ingestionRunId: RUN_ID,
          retryAfter: null,
          message: "transport_error",
        },
        { ...context, attempts: 3 },
      ),
    ).toMatchObject({
      kind: "defer",
      signal: "unavailable",
      ingestionRunId: RUN_ID,
      jobNotBefore: "2026-09-16T12:01:00.000Z",
      failure: {
        code: "source_signal",
        message: "unavailable: transport_error",
      },
    });
  });
});

describe("transiciones", () => {
  const running = () => startItemAttempt(item(), TOKEN, T0);

  it("empezar cuenta el intento y exige un item listo", () => {
    expect(running()).toMatchObject({
      status: "running",
      attempts: 1,
      leaseToken: TOKEN,
      startedAt: T0,
    });
    expect(() =>
      startItemAttempt(
        item({
          attempts: 1,
          lastFailure: failure,
          notBefore: "2026-09-16T12:00:01.000Z",
        }),
        TOKEN,
        T0,
      ),
    ).toThrow(IngestionJobTransitionError);
    expect(() => startItemAttempt(running(), TOKEN, T0)).toThrow(
      IngestionJobTransitionError,
    );
  });

  it("diferir devuelve el intento sin bajar de cero", () => {
    const deferred = applyItemDecision(
      running(),
      {
        kind: "defer",
        ingestionRunId: null,
        signal: "throttled",
        jobNotBefore: T0,
        failure: { code: "source_signal", message: "429", retryable: true },
      },
      T0,
    );

    expect(deferred).toMatchObject({ status: "pending", attempts: 0 });
    expect(() =>
      applyItemDecision(
        deferred,
        { kind: "complete", ingestionRunId: RUN_ID },
        T0,
      ),
    ).toThrow(IngestionJobTransitionError);
  });

  it("una corrida nueva reemplaza a la anterior y la ausencia la conserva", () => {
    const retried = applyItemDecision(
      running(),
      { kind: "retry", ingestionRunId: RUN_ID, failure, notBefore: null },
      T0,
    );
    const again = startItemAttempt(retried, TOKEN, T0);
    const poisoned = applyItemDecision(
      again,
      { kind: "poison", ingestionRunId: null, failure },
      T0,
    );

    expect(poisoned).toMatchObject({
      status: "poisoned",
      ingestionRunId: RUN_ID,
    });
  });

  it("el huérfano vuelve a la cola sin espera o se envenena en el techo", () => {
    const orphan = item({
      status: "running",
      leaseToken: TOKEN,
      startedAt: T0,
      attempts: 2,
    });

    expect(decideOrphanRecovery(orphan, 3)).toMatchObject({
      kind: "retry",
      notBefore: null,
      failure: { code: "lease_expired" },
    });
    expect(decideOrphanRecovery(orphan, 2)).toMatchObject({ kind: "poison" });
  });

  it("avanzar completa el job, limpia su backoff y conserva la espera más larga", () => {
    const later = "2026-09-16T12:10:00.000Z";
    const waiting = advanceJob(job(), 0, {
      now: T0,
      actor: "worker",
      leaseToken: TOKEN,
      jobNotBefore: later,
    });

    expect(waiting.job.notBefore).toBe(later);
    expect(
      advanceJob(waiting.job, 0, {
        now: T0,
        actor: "worker",
        leaseToken: TOKEN,
        jobNotBefore: "2026-09-16T12:01:00.000Z",
      }).job.notBefore,
    ).toBe(later);

    expect(
      advanceJob(waiting.job, 1, {
        now: "2026-09-16T12:10:00.000Z",
        actor: "worker",
        leaseToken: TOKEN,
      }).job.notBefore,
    ).toBeNull();

    const done = advanceJob(waiting.job, 2, {
      now: T0,
      actor: "worker",
      leaseToken: TOKEN,
    });

    expect(done.job).toMatchObject({
      status: "completed",
      notBefore: null,
      finishedAt: T0,
    });
    expect(done.events.map((event) => event.eventType)).toEqual([
      "job_completed",
    ]);

    const cancelled = job({ status: "cancelled", finishedAt: T0 });
    expect(
      advanceJob(cancelled, 2, { now: T0, actor: "owner", leaseToken: null })
        .job.status,
    ).toBe("cancelled");
  });

  it("reencolar pone los intentos en cero y reabrir no aplica a un job cancelado", () => {
    const failed = item({
      status: "failed",
      attempts: 3,
      finishedAt: T0,
      lastFailure: failure,
    });

    expect(requeueItemState(failed, T0)).toMatchObject({
      status: "pending",
      attempts: 0,
      finishedAt: null,
      lastFailure: failure,
    });
    expect(() => requeueItemState(item(), T0)).toThrow(
      IngestionJobTransitionError,
    );
    expect(
      reopenJob(job({ status: "completed", cursor: 2, finishedAt: T0 }), 1, T0),
    ).toMatchObject({ status: "open", cursor: 1, finishedAt: null });
    expect(() =>
      reopenJob(job({ status: "cancelled", finishedAt: T0 }), 0, T0),
    ).toThrow(IngestionJobTransitionError);
  });
});

describe("cursor, motivo y detalle", () => {
  it("el cursor es el primer item no terminal", () => {
    expect(
      computeJobCursor(
        [
          { ordinal: 0, status: "completed" },
          { ordinal: 1, status: "poisoned" },
          { ordinal: 2, status: "pending" },
          { ordinal: 3, status: "running" },
        ],
        4,
      ),
    ).toBe(2);
    expect(
      computeJobCursor(
        [
          { ordinal: 0, status: "failed" },
          { ordinal: 1, status: "completed" },
        ],
        2,
      ),
    ).toBe(2);
  });

  it("el motivo se redacta y exige texto", () => {
    expect(ingestionJobReasonSchema.parse("rotar password=hunter2 ya")).toBe(
      "rotar password=[redacted] ya",
    );
    expect(() => ingestionJobReasonSchema.parse("  ")).toThrow();
  });

  it("el detalle de un evento es plano y acotado", () => {
    expect(() =>
      ingestionJobEventDetailSchema.parse({ nested: { value: 1 } }),
    ).toThrow();
    expect(() =>
      ingestionJobEventDetailSchema.parse(
        Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => [`k${index}`, index]),
        ),
      ),
    ).toThrow();
    expect(() =>
      ingestionJobEventDetailSchema.parse({ "bad key": 1 }),
    ).toThrow();
    expect(
      ingestionJobEventDetailSchema.parse({ attempt: 1, note: null }),
    ).toEqual({
      attempt: 1,
      note: null,
    });
  });
});
