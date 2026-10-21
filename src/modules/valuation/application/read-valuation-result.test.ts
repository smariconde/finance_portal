import { describe, expect, it } from "vitest";

import {
  DEMO_CURRENT_SYMBOL,
  DEMO_IDENTITY_GRAPH,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";

import {
  buildDemoValuationRun,
  buildDemoValuationRunBeforeAmendment,
} from "../infrastructure/demo-valuation-run";
import { createInMemoryValuationJobStore } from "../infrastructure/in-memory-valuation-job-store";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import {
  addMilliseconds,
  outcomeForAssessment,
  outcomeForIdentity,
  queueValuationJob,
  type ValuationJobOutcome,
} from "../domain/valuation-job";
import { readValuationResult, subjectAt } from "./read-valuation-result";
import type { ValuationJobStore } from "./valuation-job-store";

const T0 = "2026-10-21T15:00:00.000Z";
const READING = {
  legalEntityId: "33333333-3333-4333-8333-333333333333",
  securityId: "44444444-4444-4444-8444-444444444444",
  listingId: null,
  cik: "0000320193",
  hasAnnualFundamentals: true,
  methodStatus: "selected",
  assetProfile: "non_financial_mature",
  method: "fcff_base",
  rigor: "standard",
  unsupportedReason: null,
} as const;

const universe = {
  loadState: async () => ({ graph: DEMO_IDENTITY_GRAPH, memberships: [] }),
};

let sequence = 0;

async function finished(
  store: ValuationJobStore,
  outcome: ValuationJobOutcome,
): Promise<void> {
  sequence += 1;
  const at = addMilliseconds(T0, sequence * 1_000);
  const job = queueValuationJob({
    jobId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ticker: "AAPL",
    knownAt: at,
    createdAt: at,
  });
  const token = `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  await store.insert(job);
  await store.claim({
    jobId: job.jobId,
    startedAt: at,
    claimToken: token,
    staleBefore: at,
  });
  await store.finish({
    jobId: job.jobId,
    claimToken: token,
    finishedAt: at,
    outcome,
  });
}

describe("readValuationResult", () => {
  it("names a ticker that never finished a job", async () => {
    const reading = await readValuationResult(
      { ticker: "aapl" },
      {
        jobs: createInMemoryValuationJobStore(),
        runs: createInMemoryValuationRunRepository(),
        universe,
      },
    );

    expect(reading).toEqual({ state: "not_requested", ticker: "AAPL" });
  });

  it("names the latest gap when no job recorded a run", async () => {
    const jobs = createInMemoryValuationJobStore();
    await finished(jobs, outcomeForIdentity("not_found"));
    await finished(
      jobs,
      outcomeForAssessment(READING, { gap: "employee_equity_not_proposed" }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs: createInMemoryValuationRunRepository(), universe },
    );

    expect(reading.state).toBe("no_run");
    expect(reading.state === "no_run" && reading.latest).toMatchObject({
      gap: "snapshot_not_assembled",
      snapshotGap: "employee_equity_not_proposed",
    });
  });

  it("shows the latest recorded run and the newer job that recorded none", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const older = await runs.record(buildDemoValuationRunBeforeAmendment());
    const newer = await runs.record(buildDemoValuationRun());
    const recorded = (valuationRunId: string) =>
      outcomeForAssessment(READING, { valuationRunId, runStatus: "computed" });

    await finished(jobs, recorded(older.valuationRunId));
    await finished(jobs, recorded(newer.valuationRunId));
    await finished(
      jobs,
      outcomeForAssessment(READING, { gap: "market_unavailable" }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs, universe },
    );

    expect(reading.state).toBe("run");
    if (reading.state !== "run") return;

    expect(reading.run.valuationRunId).toBe(newer.valuationRunId);
    expect(reading.newerGap?.snapshotGap).toBe("market_unavailable");
    expect(reading.subject).toMatchObject({
      cik: "999901",
      symbol: DEMO_CURRENT_SYMBOL.symbol,
    });
  });

  it("has no newer gap when the latest job recorded the run", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const run = await runs.record(buildDemoValuationRun());

    await finished(
      jobs,
      outcomeForAssessment(READING, {
        valuationRunId: run.valuationRunId,
        runStatus: "computed",
      }),
    );

    const reading = await readValuationResult(
      { ticker: "AAPL" },
      { jobs, runs, universe },
    );

    expect(reading.state === "run" && reading.newerGap).toBeNull();
  });
});

describe("subjectAt", () => {
  it("reads identity at the run's cutoff, so a later version does not leak in", () => {
    const run = buildDemoValuationRun();
    const entity = DEMO_IDENTITY_GRAPH.legalEntities.find(
      (candidate) => candidate.legalEntityId === run.subject.legalEntityId,
    )!;
    // Una versión conocida después del corte de la corrida.
    const later = "2099-01-01T00:00:00.000Z";
    const graph = {
      ...DEMO_IDENTITY_GRAPH,
      legalEntities: DEMO_IDENTITY_GRAPH.legalEntities.map((candidate) =>
        candidate.legalEntityId === entity.legalEntityId
          ? { ...candidate, availableAt: later, recordedAt: later }
          : candidate,
      ),
    };

    expect(subjectAt(DEMO_IDENTITY_GRAPH, run)?.legalName).toBe(
      entity.legalName,
    );
    expect(subjectAt(graph, run)).toBeNull();
  });
});
