import { describe, expect, it, vi } from "vitest";

import {
  ingestionJobItemSchema,
  ingestionJobPlanSchema,
  ingestionJobSchema,
  type IngestionJob,
  type IngestionJobItem,
} from "@/modules/ingestion/domain/ingestion-job";
import {
  ingestionRunSchema,
  type IngestionRun,
  type IngestionRunStatus,
} from "@/modules/ingestion/domain/ingestion-run";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import type { SourceSignal } from "./company-facts-backfill";
import {
  assertCompanyFactsRefreshJob,
  buildCompanyFactsRefreshJobPlan,
  createCompanyFactsRefreshJobExecutor,
  MAX_REQUESTS_PER_REFRESH_ITEM,
} from "./company-facts-refresh-job";
import { SubjectNotInUniverseError } from "./ingest-company-facts";
import type { RefreshCompanyFactsOutcome } from "./refresh-company-facts";

const CLOCK = "2026-09-18T12:00:00.000Z";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PROBE_RUN_ID = "22222222-2222-4222-8222-222222222222";
const FACTS_RUN_ID = "33333333-3333-4333-8333-333333333333";
const CIK = "0000320193";

const subject = (cik: string) => ({
  cik,
  legalEntityId: "44444444-4444-4444-8444-444444444444",
  observations: 10,
  latestAvailableAt: CLOCK,
  symbols: [],
});

function run(
  overrides: {
    runId?: string;
    datasetId?: string;
    status?: IngestionRunStatus;
    failureCode?: "provider_error" | "rights_not_approved";
    retryable?: boolean;
  } = {},
): IngestionRun {
  const status = overrides.status ?? "succeeded";

  return ingestionRunSchema.parse({
    runId: overrides.runId ?? PROBE_RUN_ID,
    sourceId: "sec-edgar",
    datasetId: overrides.datasetId ?? "sec.submissions",
    parserVersion: "sec-refresh-probe-1.0.0",
    idempotencyKey: "a".repeat(64),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: CIK,
    selectionVersion: null,
    selectionAnchorOn: null,
    status,
    startedAt: CLOCK,
    finishedAt: CLOCK,
    counts:
      status === "failed"
        ? { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 }
        : status === "duplicate"
          ? { fetched: 1, accepted: 0, rejected: 0, duplicate: 1 }
          : { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
    contentHash: status === "failed" ? null : "b".repeat(64),
    failure:
      status === "failed"
        ? {
            code: overrides.failureCode ?? "provider_error",
            message: "la SEC no contestó",
            retryable: overrides.retryable ?? true,
          }
        : null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: CLOCK,
  });
}

function outcome(
  overrides: Partial<RefreshCompanyFactsOutcome> = {},
): RefreshCompanyFactsOutcome {
  return {
    persisted: true,
    cik: CIK,
    probeRun: run(),
    decision: null,
    previous: null,
    state: null,
    ingestion: null,
    ...overrides,
  };
}

const item: IngestionJobItem = ingestionJobItemSchema.parse({
  jobId: JOB_ID,
  ordinal: 0,
  subjectKey: CIK,
  status: "running",
  attempts: 1,
  notBefore: null,
  leaseToken: "55555555-5555-4555-8555-555555555555",
  startedAt: CLOCK,
  finishedAt: null,
  ingestionRunId: null,
  lastFailure: null,
  updatedAt: CLOCK,
});

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return ingestionJobSchema.parse({
    jobId: JOB_ID,
    kind: "sec_companyfacts_refresh",
    sourceId: "sec-edgar",
    datasetId: "sec.companyfacts",
    parserVersion: "sec-refresh-probe-1.0.0",
    selectionVersion: "sec-companyfacts-forms-1.0.0",
    planHash: "c".repeat(64),
    itemCount: 1,
    maxAttempts: 3,
    status: "open",
    cursor: 0,
    notBefore: null,
    statusReason: null,
    createdAt: CLOCK,
    updatedAt: CLOCK,
    finishedAt: null,
    ...overrides,
  });
}

/**
 * El ejecutor limpia la señal antes de empezar, así que la del intento aparece
 * recién en la segunda lectura: es la que llegó durante la vuelta.
 */
function executorWith(
  refresh: (cik: string) => Promise<RefreshCompanyFactsOutcome>,
  signal: SourceSignal | null = null,
) {
  let takes = 0;

  return createCompanyFactsRefreshJobExecutor({
    refresh,
    takeSignal: () => {
      takes += 1;
      return takes === 1 ? null : signal;
    },
  });
}

describe("plan del job de refresh", () => {
  it("nombra el sondeo y la lista de formularios, en el orden del CIK", () => {
    const plan = ingestionJobPlanSchema.parse(
      buildCompanyFactsRefreshJobPlan([
        subject("0000320193"),
        subject("0001045810"),
      ]),
    );

    expect(plan).toMatchObject({
      kind: "sec_companyfacts_refresh",
      sourceId: "sec-edgar",
      datasetId: "sec.companyfacts",
      parserVersion: "sec-refresh-probe-1.0.0",
      selectionVersion: "sec-companyfacts-forms-1.0.0",
      subjects: ["0000320193", "0001045810"],
    });
  });

  it("reserva el sondeo más la carga completa", () => {
    expect(MAX_REQUESTS_PER_REFRESH_ITEM).toBe(67);
  });

  it("no corre un job planeado con otra lista de formularios", () => {
    expect(() => assertCompanyFactsRefreshJob(job())).not.toThrow();
    expect(() =>
      assertCompanyFactsRefreshJob(
        job({ selectionVersion: "sec-companyfacts-forms-0.9.0" }),
      ),
    ).toThrow(/selectionVersion/u);
    expect(() =>
      assertCompanyFactsRefreshJob(job({ kind: "sec_companyfacts_backfill" })),
    ).toThrow(/kind/u);
  });
});

describe("ejecutor del job de refresh", () => {
  it("cierra el item con la corrida del sondeo, haya bajado o no", async () => {
    const executor = executorWith(async () =>
      outcome({ probeRun: run({ status: "duplicate" }) }),
    );

    await expect(executor(item, job())).resolves.toEqual({
      kind: "ingested",
      ingestionRunId: PROBE_RUN_ID,
    });
  });

  it("también cuando la vuelta bajó companyfacts", async () => {
    const executor = executorWith(async () =>
      outcome({
        ingestion: {
          persisted: true,
          run: run({ runId: FACTS_RUN_ID, datasetId: "sec.companyfacts" }),
          legalEntityId: null,
          documents: [],
          wire: null,
          window: null,
          vintages: null,
          rejections: [],
          stagingRejections: 0,
          sourceDocuments: null,
          publication: null,
        },
      }),
    );

    await expect(executor(item, job())).resolves.toEqual({
      kind: "ingested",
      ingestionRunId: PROBE_RUN_ID,
    });
  });

  it("una descarga fallida reintenta el item y no mueve nada", async () => {
    const executor = executorWith(async () =>
      outcome({
        ingestion: {
          persisted: true,
          run: run({
            runId: FACTS_RUN_ID,
            datasetId: "sec.companyfacts",
            status: "failed",
          }),
          legalEntityId: null,
          documents: [],
          wire: null,
          window: null,
          vintages: null,
          rejections: [],
          stagingRejections: 0,
          sourceDocuments: null,
          publication: null,
        },
      }),
    );

    await expect(executor(item, job())).resolves.toMatchObject({
      kind: "ingestion_failed",
      ingestionRunId: PROBE_RUN_ID,
      retryable: true,
    });
  });

  it("un fallo de derechos frena el job en vez de culpar al filer", async () => {
    const executor = executorWith(async () =>
      outcome({
        probeRun: run({
          status: "failed",
          failureCode: "rights_not_approved",
          retryable: false,
        }),
      }),
    );

    await expect(executor(item, job())).resolves.toMatchObject({
      kind: "source_signal",
      signal: "refused",
      message: "rights_not_approved",
    });
  });

  it("una señal de la fuente no se confunde con un problema del sujeto", async () => {
    const executor = executorWith(
      async () => outcome({ probeRun: run({ status: "failed" }) }),
      {
        kind: "throttled",
        status: 429,
        retryAfter: "2026-09-18T12:05:00.000Z",
        detail: "status 429",
      },
    );

    await expect(executor(item, job())).resolves.toMatchObject({
      kind: "source_signal",
      signal: "throttled",
      retryAfter: "2026-09-18T12:05:00.000Z",
    });
  });

  it("un sujeto fuera del universo se rechaza por nombre", async () => {
    const executor = executorWith(async () => {
      throw new SubjectNotInUniverseError(CIK, "unresolved");
    });

    await expect(executor(item, job())).resolves.toMatchObject({
      kind: "subject_rejected",
    });
  });

  it("la fuente frenada a mitad de la vuelta difiere sin gastar el intento", async () => {
    const executor = executorWith(async () => {
      throw new SourceRequestRefusedError("sec-edgar", {
        status: "source_disabled",
        reason: "frenada a mano",
      });
    });

    await expect(executor(item, job())).resolves.toMatchObject({
      kind: "source_signal",
      signal: "refused",
      message: "source_disabled",
    });
  });

  it("exige que la vuelta haya registrado su sondeo", async () => {
    const executor = executorWith(async () => outcome({ persisted: false }));

    await expect(executor(item, job())).rejects.toThrow(/persist/u);
  });

  it("pide el filer del item y no otro", async () => {
    const refresh = vi.fn(async () => outcome());
    const executor = executorWith(refresh);

    await executor(item, job());

    expect(refresh).toHaveBeenCalledWith(CIK);
  });
});
