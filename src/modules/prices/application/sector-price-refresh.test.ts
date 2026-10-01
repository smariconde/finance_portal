import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { runIngestionJob } from "@/modules/ingestion/application/run-ingestion-job";
import type { IngestionJobExecutor } from "@/modules/ingestion/application/run-ingestion-job";
import type { IngestionJob } from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";
import { createInMemoryUniverseRepository } from "@/modules/universe/infrastructure/in-memory-universe-repository";

import { PriceSourceError } from "./live-price-source";
import {
  createPriceRefreshJobExecutor,
  ensureSectorPrices,
  PRICE_REFRESH_KIND,
  PriceSubjectUnresolvedError,
  readSectorPriceReadiness,
} from "./sector-price-refresh";

const SINCE = "2020-01-01T00:00:00.000Z";
/** Miércoles después del asentamiento: la rueda esperada es la del día. */
const NOW = "2026-09-30T23:00:00.000Z";
const FIXTURE = DEMO_IDENTITY_IDS.fixtureCoClassA;
const ANDES = DEMO_IDENTITY_IDS.andesCommon;

function membership(securityId: string, suffix: string) {
  return indexMembershipSchema.parse({
    indexMembershipId: `66666666-6666-4666-8666-${suffix.padStart(12, "0")}`,
    indexId: "sp500",
    securityId,
    validFrom: SINCE,
    validTo: null,
    availableAt: SINCE,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "a".repeat(64),
    recordedAt: SINCE,
  });
}

function classification(subjectId: string, code: string, label: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: `77777777-7777-4777-8777-${subjectId.slice(-12)}`,
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code,
    label,
    validFrom: SINCE,
    validTo: null,
    availableAt: SINCE,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "b".repeat(64),
    recordedAt: SINCE,
  });
}

async function setup(options: {
  readonly referenceThrough: string | null;
  readonly closes?: Readonly<Record<string, string>>;
  /** Por defecto, las dos empresas en Energy. */
  readonly split?: boolean;
}) {
  const prices = new InMemoryPriceRepository();

  if (options.referenceThrough !== null) {
    await prices.writeBenchmarkSeries(
      ["2026-09-28", "2026-09-29", "2026-09-30"]
        .filter((date) => date <= options.referenceThrough!)
        .map((marketDate) => ({
          benchmarkId: "sp500-total-return",
          marketDate,
          close: "100",
          currency: "USD",
        })),
    );
  }

  for (const [securityId, marketDate] of Object.entries(options.closes ?? {})) {
    await prices.writeSeries(
      [{ securityId, marketDate, close: "10", currency: "USD" }],
      [],
    );
  }

  let clock = NOW;
  const jobs = createInMemoryIngestionJobStore({ newId: randomUUID });
  const budgets = createInMemorySourceBudgetStore();
  let workerActive = false;

  const dependencies = {
    universe: createInMemoryUniverseRepository({
      graph: DEMO_IDENTITY_GRAPH,
      memberships: [membership(FIXTURE, "1"), membership(ANDES, "2")],
    }),
    classifications: new InMemoryClassificationRepository([
      options.split
        ? classification(
            DEMO_IDENTITY_IDS.fixtureCoEntity,
            "communication-services",
            "Communication Services",
          )
        : classification(DEMO_IDENTITY_IDS.fixtureCoEntity, "energy", "Energy"),
      classification(DEMO_IDENTITY_IDS.andesEntity, "energy", "Energy"),
    ]),
    prices,
    jobs,
    budgets,
    now: () => clock,
    workerActive: () => workerActive,
  };

  /** Corre el job abierto hasta el final con un ejecutor de prueba. */
  async function runJob(job: IngestionJob, execute: IngestionJobExecutor) {
    return runIngestionJob(
      { jobId: job.jobId, holder: "test-worker" },
      {
        store: jobs,
        execute,
        now: () => clock,
        sleep: async () => {},
        newLeaseToken: randomUUID,
        startHeartbeat: () => () => {},
      },
    );
  }

  return {
    dependencies,
    jobs,
    budgets,
    runJob,
    setClock: (next: string) => {
      clock = next;
    },
    setWorkerActive: (next: boolean) => {
      workerActive = next;
    },
  };
}

const ingestedEverything: IngestionJobExecutor = async () => ({
  kind: "ingested",
  ingestionRunId: randomUUID(),
});

describe("ensureSectorPrices", () => {
  it("pide primero la referencia cuando le falta la rueda asentada", async () => {
    const { dependencies, jobs } = await setup({
      referenceThrough: "2026-09-29",
    });

    const first = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(first.status).toMatchObject({
      state: "running",
      phase: "reference",
      done: 0,
      total: 1,
    });
    expect(first.runJobId).not.toBeNull();

    // Idempotente: otra consulta no crea otro job.
    const second = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(second.status).toMatchObject({
      state: "running",
      phase: "reference",
    });
    expect(jobs.snapshot().jobs).toHaveLength(1);
  });

  it("no arranca otro worker si este proceso ya tiene uno", async () => {
    const { dependencies, setWorkerActive } = await setup({
      referenceThrough: "2026-09-29",
    });

    setWorkerActive(true);

    const result = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(result.status.state).toBe("running");
    expect(result.runJobId).toBeNull();
  });

  it("después de la referencia pide sólo las securities sin su última rueda", async () => {
    const { dependencies, jobs } = await setup({
      referenceThrough: "2026-09-30",
      closes: { [FIXTURE]: "2026-09-30", [ANDES]: "2026-09-29" },
    });

    const result = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(result.status).toMatchObject({
      state: "running",
      phase: "securities",
      total: 1,
    });

    const [job] = jobs.snapshot().jobs;
    expect(job!.kind).toBe(PRICE_REFRESH_KIND);
    expect(jobs.snapshot().items.map((item) => item.subjectKey)).toEqual([
      ANDES,
    ]);
  });

  it("no crea nada cuando no falta ninguna rueda", async () => {
    const { dependencies, jobs } = await setup({
      referenceThrough: "2026-09-30",
      closes: { [FIXTURE]: "2026-09-30", [ANDES]: "2026-09-30" },
    });

    const result = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(result).toEqual({
      status: { state: "fresh", targetSession: "2026-09-30", failed: [] },
      runJobId: null,
    });
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });

  it("un feriado revisado no se vuelve a pedir: la referencia ya fue consultada", async () => {
    const { dependencies, jobs, runJob } = await setup({
      referenceThrough: "2026-09-29",
      closes: { [FIXTURE]: "2026-09-29", [ANDES]: "2026-09-29" },
    });

    const first = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );
    await runJob(jobs.snapshot().jobs[0]!, ingestedEverything);

    // La fuente no trajo rueda nueva: el 30 fue feriado. La referencia queda
    // al día por revisión y las securities ya tienen su última rueda.
    expect(first.status).toMatchObject({ phase: "reference" });
    expect(
      await ensureSectorPrices({ sectorCode: "energy" }, dependencies),
    ).toEqual({
      status: { state: "fresh", targetSession: "2026-09-29", failed: [] },
      runJobId: null,
    });
  });

  it("lo que falló después de la rueda no se replanea solo, y se reintenta a pedido", async () => {
    const { dependencies, jobs, runJob } = await setup({
      referenceThrough: "2026-09-30",
      closes: { [FIXTURE]: "2026-09-30" },
    });

    await ensureSectorPrices({ sectorCode: "energy" }, dependencies);
    const result = await runJob(jobs.snapshot().jobs[0]!, async () => ({
      kind: "subject_rejected",
      message: "payload_rejected: no chart",
    }));
    expect(result.stopReason).toBe("completed");

    const after = await ensureSectorPrices(
      { sectorCode: "energy" },
      dependencies,
    );

    expect(after).toEqual({
      status: { state: "fresh", targetSession: "2026-09-30", failed: ["FIXA"] },
      runJobId: null,
    });
    expect(
      await readSectorPriceReadiness({ sectorCode: "energy" }, dependencies),
    ).toEqual({
      needsRefresh: false,
      targetSession: "2026-09-30",
      failed: ["FIXA"],
    });

    const retried = await ensureSectorPrices(
      { sectorCode: "energy", retryFailures: true },
      dependencies,
    );

    expect(retried.status).toMatchObject({
      state: "running",
      phase: "securities",
      total: 1,
    });
    expect(jobs.snapshot().jobs).toHaveLength(2);
  });

  it("una revisión anterior al asentamiento de la rueda no cuenta", async () => {
    const { dependencies, jobs, runJob, setClock } = await setup({
      referenceThrough: "2026-09-29",
      closes: { [FIXTURE]: "2026-09-29", [ANDES]: "2026-09-29" },
    });

    // Revisada el 30 a las 21:00 UTC: la rueda del 30 todavía no estaba asentada.
    setClock("2026-09-30T21:00:00.000Z");
    expect(
      (await ensureSectorPrices({ sectorCode: "energy" }, dependencies)).status,
    ).toMatchObject({ state: "fresh" });

    setClock(NOW);
    await ensureSectorPrices({ sectorCode: "energy" }, dependencies);
    await runJob(jobs.snapshot().jobs[0]!, ingestedEverything);
    // El job se creó después de las 22:00: ahora sí cuenta como revisión.
    expect(
      (await ensureSectorPrices({ sectorCode: "energy" }, dependencies)).status,
    ).toMatchObject({ state: "fresh", targetSession: "2026-09-29" });
  });

  it("con la fuente frenada no deja un job abierto que nadie puede correr", async () => {
    const { dependencies, budgets, jobs } = await setup({
      referenceThrough: "2026-09-29",
    });

    await budgets.setControl({
      controlId: randomUUID(),
      sourceId: "yahoo-finance",
      status: "disabled",
      dailyRequestLimit: null,
      reason: "prueba del kill switch",
      actor: "owner",
      now: NOW,
    });

    expect(
      (await ensureSectorPrices({ sectorCode: "energy" }, dependencies)).status,
    ).toEqual({ state: "blocked", reason: "source_disabled", resumesAt: null });
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });

  it("la descarga de otro sector se muestra como espera, no como propia", async () => {
    const { dependencies } = await setup({
      referenceThrough: "2026-09-30",
      split: true,
    });

    await ensureSectorPrices({ sectorCode: "energy" }, dependencies);

    expect(
      (
        await ensureSectorPrices(
          { sectorCode: "communication-services" },
          dependencies,
        )
      ).status,
    ).toMatchObject({ state: "running", phase: "other_sector" });
  });

  it("rechaza un código fuera de la taxonomía", async () => {
    const { dependencies } = await setup({ referenceThrough: "2026-09-30" });

    await expect(
      ensureSectorPrices({ sectorCode: "../../etc" }, dependencies),
    ).rejects.toThrow();
  });
});

describe("readSectorPriceReadiness", () => {
  it("avisa que hay que descargar sin crear ningún job", async () => {
    const { dependencies, jobs } = await setup({ referenceThrough: null });

    expect(
      await readSectorPriceReadiness({ sectorCode: "energy" }, dependencies),
    ).toEqual({ needsRefresh: true, targetSession: null, failed: [] });
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });
});

describe("createPriceRefreshJobExecutor", () => {
  const job = { datasetId: "yahoo.daily-close" } as IngestionJob;
  const item = { subjectKey: FIXTURE } as Parameters<IngestionJobExecutor>[0];

  function executor(
    failure: unknown,
    signal: Parameters<
      typeof createPriceRefreshJobExecutor
    >[0]["takeSignal"] extends () => infer S
      ? S
      : never = null,
  ) {
    let pending = signal;

    return createPriceRefreshJobExecutor({
      ingestSecurity: () => Promise.reject(failure),
      ingestBenchmark: () => Promise.reject(failure),
      takeSignal: () => {
        const taken = pending;
        pending = null;
        return taken;
      },
    });
  }

  it("una corrida registrada completa el item", async () => {
    const execute = createPriceRefreshJobExecutor({
      ingestSecurity: async () => "11111111-1111-4111-8111-111111111111",
      ingestBenchmark: async () => "22222222-2222-4222-8222-222222222222",
      takeSignal: () => null,
    });

    expect(await execute(item, job)).toEqual({
      kind: "ingested",
      ingestionRunId: "11111111-1111-4111-8111-111111111111",
    });
    expect(
      await execute(item, {
        datasetId: "yahoo.benchmark-close",
      } as IngestionJob),
    ).toEqual({
      kind: "ingested",
      ingestionRunId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("clasifica cada fallo por de quién es la culpa", async () => {
    // La señal se toma antes del intento y vuelve a tomarse en el fallo: la
    // primera lectura la descarta, así que se arma después de esa lectura.
    let signalled = false;
    const throttled = createPriceRefreshJobExecutor({
      ingestSecurity: async () => {
        signalled = true;
        throw new PriceSourceError("unexpected_status", "FIXA", "429");
      },
      ingestBenchmark: () => Promise.reject(new Error("unused")),
      takeSignal: () =>
        signalled
          ? {
              kind: "throttled",
              status: 429,
              retryAfter: "30",
              detail: "status 429",
            }
          : null,
    });

    expect(await throttled(item, job)).toMatchObject({
      kind: "source_signal",
      signal: "throttled",
      retryAfter: "30",
    });
    expect(
      await executor(
        new SourceRequestRefusedError("yahoo-finance", {
          status: "source_disabled",
          reason: "pausa",
        }),
      )(item, job),
    ).toMatchObject({ kind: "source_signal", signal: "refused" });
    expect(
      await executor(new PriceSourceError("rights_not_approved", "FIXA"))(
        item,
        job,
      ),
    ).toMatchObject({ kind: "source_signal", signal: "refused" });
    expect(
      await executor(new PriceSourceError("payload_rejected", "FIXA"))(
        item,
        job,
      ),
    ).toMatchObject({ kind: "subject_rejected" });
    expect(
      await executor(new PriceSubjectUnresolvedError(FIXTURE))(item, job),
    ).toMatchObject({ kind: "subject_rejected" });
    expect(
      await executor(new PriceSourceError("fetch_failed", "FIXA"))(item, job),
    ).toMatchObject({ kind: "executor_error" });
    await expect(executor(new TypeError("bug"))(item, job)).rejects.toThrow(
      TypeError,
    );
  });
});
