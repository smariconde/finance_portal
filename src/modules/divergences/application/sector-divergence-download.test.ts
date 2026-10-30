import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import { COMPANY_FACTS_BACKFILL_KIND } from "@/modules/fundamentals/application/company-facts-backfill";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import {
  runIngestionJob,
  type IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import type { IngestionRunRepository } from "@/modules/ingestion/application/ingestion-run-repository";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";
import { SOURCE_DAILY_REQUEST_BUDGETS } from "@/modules/ingestion/domain/source-budget";
import { PRICES_DATASET_ID } from "@/modules/prices/application/ingest-prices";
import { isFiscalPriceHistoryJob } from "@/modules/prices/application/sector-price-refresh";
import { FISCAL_PRICE_HISTORY_VERSION } from "@/modules/prices/domain/fiscal-price-history";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";
import { createInMemoryUniverseRepository } from "@/modules/universe/infrastructure/in-memory-universe-repository";

import type { SectorFiscalReading } from "./load-sector-fiscal-endpoints";
import {
  ensureSectorDivergenceDownload,
  readSectorDivergenceDownload,
  type SectorDivergenceDownloadDependencies,
} from "./sector-divergence-download";

const SINCE = "2020-01-01T00:00:00.000Z";
const NOW = "2026-10-30T15:00:00.000Z";
const FIXTURE = DEMO_IDENTITY_IDS.fixtureCoClassA;
const FIXTURE_CIK = "0000999901";

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

function energy(subjectId: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: `77777777-7777-4777-8777-${subjectId.slice(-12)}`,
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code: "energy",
    label: "Energy",
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

function run(options: {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly subjectKey: string;
  readonly selectionVersion: string;
  readonly anchor: string;
}) {
  const runId = randomUUID();
  return ingestionRunSchema.parse({
    runId,
    sourceId: options.sourceId,
    datasetId: options.datasetId,
    parserVersion: "test-parser-1.0.0",
    idempotencyKey: runId.replaceAll("-", "").padEnd(64, "a"),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: options.subjectKey,
    selectionVersion: options.selectionVersion,
    selectionAnchorOn: options.anchor,
    status: "succeeded",
    startedAt: "2026-10-29T12:00:00.000Z",
    finishedAt: "2026-10-29T12:00:01.000Z",
    counts: { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
    contentHash: "b".repeat(64),
    failure: null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: "2026-10-29T12:00:01.000Z",
  });
}

const secRun = () =>
  run({
    sourceId: "sec-edgar",
    datasetId: COMPANY_FACTS_DATASET_ID,
    subjectKey: FIXTURE_CIK,
    selectionVersion: "sec-core-concepts-8.0.0",
    anchor: "2025-12-31",
  });

/** FixtureCo con el cierre de hace cinco ejercicios sin precio. */
function reading(earlierPrice: boolean): SectorFiscalReading {
  const endpoint = (fiscalYearEnd: string, price: boolean) => ({
    fiscalYearEnd,
    price: price ? { marketDate: fiscalYearEnd } : null,
  });
  return {
    sectorCode: "energy",
    members: [
      {
        securityId: FIXTURE,
        issuerLegalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
        ticker: "FIX",
        issuerName: "FixtureCo",
        twoYears: {
          latest: endpoint("2025-12-31", true),
          earlier: endpoint("2023-12-31", true),
        },
        fiveYears: {
          latest: endpoint("2025-12-31", true),
          earlier: endpoint("2020-12-31", earlierPrice),
        },
      },
    ],
  } as unknown as SectorFiscalReading;
}

function setup(
  options: {
    readonly runs?: Parameters<typeof createInMemoryIngestionRunRepository>[0];
    readonly secBudget?: number;
    readonly earlierPrice?: boolean;
  } = {},
) {
  const jobs = createInMemoryIngestionJobStore({ newId: randomUUID });
  const ingestionRuns: IngestionRunRepository =
    createInMemoryIngestionRunRepository(options.runs ?? []);
  let workerActive = false;
  const dependencies: SectorDivergenceDownloadDependencies = {
    universe: createInMemoryUniverseRepository({
      graph: DEMO_IDENTITY_GRAPH,
      memberships: [
        membership(FIXTURE, "1"),
        membership(DEMO_IDENTITY_IDS.andesCommon, "2"),
      ],
    }),
    classifications: new InMemoryClassificationRepository([
      energy(DEMO_IDENTITY_IDS.fixtureCoEntity),
      energy(DEMO_IDENTITY_IDS.andesEntity),
    ]),
    listRelationships: async () => [],
    ingestionRuns,
    jobs,
    budgets: createInMemorySourceBudgetStore({
      ...SOURCE_DAILY_REQUEST_BUDGETS,
      ...(options.secBudget === undefined
        ? {}
        : { "sec-edgar": options.secBudget }),
    }),
    readFiscal: async () => reading(options.earlierPrice ?? false),
    now: () => NOW,
    workerActive: () => workerActive,
  };

  async function finish(execute: IngestionJobExecutor) {
    const [job] = await jobs.listJobs({ statuses: ["open"] });
    await runIngestionJob(
      { jobId: job!.jobId, holder: "test-worker" },
      {
        store: jobs,
        execute,
        now: () => NOW,
        sleep: async () => {},
        newLeaseToken: randomUUID,
        startHeartbeat: () => () => {},
      },
    );
  }

  return {
    dependencies,
    jobs,
    ingestionRuns,
    finish,
    setWorkerActive: (next: boolean) => {
      workerActive = next;
    },
  };
}

const request = { sectorCode: "energy", retryFailures: false };

describe("sector-divergence-download-1.0.0", () => {
  it("el render sólo lee: dice cuántos filers bajaría y no crea un job", async () => {
    const { dependencies, jobs } = setup();

    const status = await readSectorDivergenceDownload(
      { sectorCode: "energy", reading: reading(false) },
      dependencies,
    );

    // Andes no tiene CIK: el plan del backfill la rechaza y no es un filer.
    expect(status).toEqual({
      state: "pending",
      filers: 1,
      priceHistories: 0,
      failedFilers: [],
      failedPrices: [],
    });
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });

  it("baja primero los fundamentales de los filers sin corrida, una sola vez", async () => {
    const { dependencies, jobs, setWorkerActive } = setup();

    const first = await ensureSectorDivergenceDownload(request, dependencies);

    expect(first.status).toMatchObject({
      state: "running",
      phase: "fundamentals",
      done: 0,
      total: 1,
    });
    expect(first.run).toMatchObject({ source: "sec-edgar" });
    const [job] = jobs.snapshot().jobs;
    expect(job).toMatchObject({ kind: COMPANY_FACTS_BACKFILL_KIND });

    // Idempotente, y un proceso con worker no arranca otro.
    setWorkerActive(true);
    const second = await ensureSectorDivergenceDownload(request, dependencies);
    expect(second.status).toMatchObject({ phase: "fundamentals" });
    expect(second.run).toBeNull();
    expect(jobs.snapshot().jobs).toHaveLength(1);
  });

  it("con la SEC al día pide siete años donde falta el cierre fiscal", async () => {
    const { dependencies, jobs } = setup({ runs: [secRun()] });

    const result = await ensureSectorDivergenceDownload(request, dependencies);

    expect(result.status).toMatchObject({
      state: "running",
      phase: "prices",
      total: 1,
    });
    expect(result.run).toMatchObject({ source: "yahoo-finance" });
    const [job] = jobs.snapshot().jobs;
    expect(isFiscalPriceHistoryJob(job!)).toBe(true);
  });

  it("una security ya pedida desde antes de su cierre no se vuelve a pedir", async () => {
    const { dependencies, jobs } = setup({
      runs: [
        secRun(),
        run({
          sourceId: "yahoo-finance",
          datasetId: PRICES_DATASET_ID,
          subjectKey: "FIX",
          selectionVersion: FISCAL_PRICE_HISTORY_VERSION,
          anchor: "2019-10-15",
        }),
      ],
    });

    const result = await ensureSectorDivergenceDownload(request, dependencies);

    expect(result).toEqual({
      status: { state: "complete", failedFilers: [], failedPrices: [] },
      run: null,
    });
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });

  it("con todo guardado no hay nada que bajar", async () => {
    const { dependencies } = setup({ runs: [secRun()], earlierPrice: true });

    expect(
      (await ensureSectorDivergenceDownload(request, dependencies)).status,
    ).toEqual({ state: "complete", failedFilers: [], failedPrices: [] });
  });

  it("un filer que falló se nombra y sólo se reintenta si el owner lo pide", async () => {
    const { dependencies, jobs, finish } = setup({ earlierPrice: true });

    await ensureSectorDivergenceDownload(request, dependencies);
    await finish(async () => ({
      kind: "subject_rejected",
      message: "not in universe",
    }));

    // Sin corrida anclada pero revisado: no se replanea en cada clic.
    const after = await ensureSectorDivergenceDownload(request, dependencies);
    expect(after.status).toEqual({
      state: "complete",
      failedFilers: ["FXCO"],
      failedPrices: [],
    });
    expect(jobs.snapshot().jobs).toHaveLength(1);

    const retried = await ensureSectorDivergenceDownload(
      { sectorCode: "energy", retryFailures: true },
      dependencies,
    );
    expect(retried.status).toMatchObject({ phase: "fundamentals" });
    expect(jobs.snapshot().jobs).toHaveLength(2);
  });

  it("sin cuota para el peor caso de un filer no deja un job abierto", async () => {
    const { dependencies, jobs } = setup({ secBudget: 10 });

    const result = await ensureSectorDivergenceDownload(request, dependencies);

    expect(result.status).toMatchObject({
      state: "blocked",
      source: "sec-edgar",
      reason: "daily_budget_exhausted",
    });
    expect(result.run).toBeNull();
    expect(jobs.snapshot().jobs).toHaveLength(0);
  });

  it("una descarga SEC de otro sujeto ocupa la fuente y ésta espera", async () => {
    const { dependencies, jobs } = setup();
    await jobs.createJob(
      {
        kind: COMPANY_FACTS_BACKFILL_KIND,
        sourceId: "sec-edgar",
        datasetId: COMPANY_FACTS_DATASET_ID,
        parserVersion: "p",
        selectionVersion: "s",
        subjects: ["0000320193"],
      },
      { now: NOW },
    );

    const result = await ensureSectorDivergenceDownload(request, dependencies);

    expect(result.status).toMatchObject({
      state: "running",
      phase: "other_download",
    });
    expect(jobs.snapshot().jobs).toHaveLength(1);
  });
});
