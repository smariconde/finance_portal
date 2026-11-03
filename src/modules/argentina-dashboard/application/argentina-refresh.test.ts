import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  runIngestionJob,
  type IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { IngestionJob } from "@/modules/ingestion/domain/ingestion-job";
import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";

import {
  ARGENTINA_REFRESH_KIND,
  ARGENTINA_REFRESH_SOURCES,
  ensureArgentinaRefresh,
  openRefreshJobs,
  readArgentinaRefreshReadiness,
  refreshSourceOf,
} from "./argentina-refresh";

// A Tuesday afternoon: the daily threshold is Monday 23:00 UTC.
const NOW = "2026-11-03T15:00:00.000Z";
const ALL_SUBJECTS = ARGENTINA_REFRESH_SOURCES.reduce(
  (total, source) => total + source.subjects.length,
  0,
);

function setup() {
  let clock = NOW;
  const jobs = createInMemoryIngestionJobStore({ newId: randomUUID });
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const budgets = createInMemorySourceBudgetStore();
  let workerActive = false;
  const dependencies = {
    jobs,
    ingestionRuns,
    budgets,
    now: () => clock,
    workerActive: () => workerActive,
  };

  async function recordRun(job: IngestionJob, subjectKey: string) {
    const runId = randomUUID();
    await ingestionRuns.append(
      ingestionRunSchema.parse({
        runId,
        sourceId: job.sourceId,
        datasetId: job.datasetId,
        parserVersion: job.parserVersion,
        idempotencyKey: computeContentHash({ runId }),
        requestedAsOf: null,
        cursor: null,
        nextCursor: null,
        subjectKey,
        status: "duplicate",
        startedAt: clock,
        finishedAt: clock,
        counts: { fetched: 1, accepted: 0, rejected: 0, duplicate: 1 },
        contentHash: computeContentHash({ subjectKey }),
        failure: null,
        qualityFlags: [],
        replayOfRunId: null,
        recordedAt: clock,
      }),
    );
    return runId;
  }

  /** Records a run for every item, as the real recorders do. */
  const recordsEverything: IngestionJobExecutor = async (item, job) => ({
    kind: "ingested",
    ingestionRunId: await recordRun(job, item.subjectKey),
  });

  /** The source answers with nothing the recorder can keep. */
  const rejectsEverything: IngestionJobExecutor = async () => ({
    kind: "subject_rejected",
    message: "schema_changed",
  });

  async function runOpen(execute: (job: IngestionJob) => IngestionJobExecutor) {
    for (const job of await openRefreshJobs(jobs)) {
      await runIngestionJob(
        { jobId: job.jobId, holder: "test-worker" },
        {
          store: jobs,
          execute: execute(job),
          now: () => clock,
          sleep: async () => {},
          newLeaseToken: randomUUID,
          startHeartbeat: () => () => {},
        },
      );
    }
  }

  return {
    dependencies,
    jobs,
    budgets,
    recordRun,
    recordsEverything,
    rejectsEverything,
    runOpen,
    setClock: (next: string) => {
      clock = next;
    },
    setWorkerActive: (next: boolean) => {
      workerActive = next;
    },
  };
}

describe("ensureArgentinaRefresh", () => {
  it("plans one job per source with everything never checked", async () => {
    const { dependencies, jobs } = setup();
    expect(
      (await readArgentinaRefreshReadiness(dependencies)).needsRefresh,
    ).toBe(true);

    const result = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(result.runWorker).toBe(true);
    expect(result.status).toMatchObject({
      state: "running",
      done: 0,
      total: ALL_SUBJECTS,
    });
    const open = await openRefreshJobs(jobs);
    expect(open.map((job) => job.sourceId).sort()).toEqual(
      ARGENTINA_REFRESH_SOURCES.map((source) => source.sourceId).sort(),
    );
    expect(open.every((job) => job.kind === ARGENTINA_REFRESH_KIND)).toBe(true);

    // Asking again while open plans nothing new.
    await ensureArgentinaRefresh({ retryFailures: false }, dependencies);
    expect(await openRefreshJobs(jobs)).toHaveLength(open.length);
  });

  it("is fresh after a run and asks the daily sources again after the next settle", async () => {
    const { dependencies, runOpen, recordsEverything, setClock } = setup();
    await ensureArgentinaRefresh({ retryFailures: false }, dependencies);
    await runOpen(() => recordsEverything);

    expect(
      await ensureArgentinaRefresh({ retryFailures: false }, dependencies),
    ).toEqual({
      status: { state: "fresh", failedSources: [] },
      runWorker: false,
    });
    expect(
      (await readArgentinaRefreshReadiness(dependencies)).needsRefresh,
    ).toBe(false);

    // Tuesday 23:30 UTC: only the daily sources are due again.
    setClock("2026-11-03T23:30:00.000Z");
    const next = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(next.status).toMatchObject({
      state: "running",
      sources: ["BCRA", "pares ADR del CCL"],
    });
  });

  it("does not replan a failure on its own, only when the owner retries", async () => {
    const { dependencies, jobs, runOpen, rejectsEverything } = setup();
    await ensureArgentinaRefresh({ retryFailures: false }, dependencies);
    await runOpen(() => rejectsEverything);

    const fresh = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(fresh.status).toMatchObject({ state: "fresh" });
    expect(
      fresh.status.state === "fresh" ? fresh.status.failedSources : [],
    ).toHaveLength(ARGENTINA_REFRESH_SOURCES.length);
    expect(await openRefreshJobs(jobs)).toHaveLength(0);

    const retried = await ensureArgentinaRefresh(
      { retryFailures: true },
      dependencies,
    );
    expect(retried.status).toMatchObject({ state: "running" });
  });

  it("counts a hand-run command's run as a check", async () => {
    const { dependencies, recordRun } = setup();
    const indec = refreshSourceOf("indec-api");
    const fakeJob = {
      sourceId: indec.sourceId,
      datasetId: indec.datasetId,
      parserVersion: indec.parserVersion,
    } as IngestionJob;
    for (const subject of indec.subjects) await recordRun(fakeJob, subject);

    const result = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(result.status).toMatchObject({ state: "running" });
    expect(
      result.status.state === "running" ? result.status.sources : [],
    ).not.toContain("INDEC");
  });

  it("leaves no job for a stopped source and names it", async () => {
    const { dependencies, budgets, jobs } = setup();
    for (const source of ARGENTINA_REFRESH_SOURCES) {
      await budgets.setControl({
        controlId: randomUUID(),
        sourceId: source.sourceId,
        status: "disabled",
        dailyRequestLimit: null,
        reason: "prueba del kill switch",
        actor: "owner",
        now: NOW,
      });
    }
    const result = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(result).toEqual({
      status: {
        state: "blocked",
        reason: "source_disabled",
        source: "BCRA",
        resumesAt: null,
      },
      runWorker: false,
    });
    expect(await openRefreshJobs(jobs)).toHaveLength(0);
  });

  it("keeps the round's finished jobs in the progress", async () => {
    const { dependencies, jobs, recordsEverything, setClock } = setup();
    await ensureArgentinaRefresh({ retryFailures: false }, dependencies);
    const [first] = await openRefreshJobs(jobs);
    setClock("2026-11-03T15:00:05.000Z");
    await runIngestionJob(
      { jobId: first!.jobId, holder: "test-worker" },
      {
        store: jobs,
        execute: recordsEverything,
        now: () => "2026-11-03T15:00:05.000Z",
        sleep: async () => {},
        newLeaseToken: randomUUID,
        startHeartbeat: () => () => {},
      },
    );
    const status = (
      await ensureArgentinaRefresh({ retryFailures: false }, dependencies)
    ).status;
    expect(status).toMatchObject({
      state: "running",
      done: first!.itemCount,
      total: ALL_SUBJECTS,
    });
  });

  it("does not start a second worker in the same process", async () => {
    const { dependencies, setWorkerActive } = setup();
    setWorkerActive(true);
    const result = await ensureArgentinaRefresh(
      { retryFailures: false },
      dependencies,
    );
    expect(result.runWorker).toBe(false);
    expect(result.status).toMatchObject({ state: "running" });
  });
});
