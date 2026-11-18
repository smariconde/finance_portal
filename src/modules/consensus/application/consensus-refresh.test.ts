import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  runIngestionJob,
  type IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";
import { createInMemoryIngestionJobStore } from "@/modules/ingestion/infrastructure/in-memory-ingestion-job-store";
import { createInMemorySourceBudgetStore } from "@/modules/ingestion/infrastructure/in-memory-source-budget-store";

import { assessConsensusFreshness } from "../domain/consensus-freshness";
import {
  classifyConsensusFailure,
  ensureConsensus,
  readConsensusReadiness,
} from "./consensus-refresh";
import { ConsensusSourceError } from "./live-consensus-source";

const SECURITY = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
// 2026-11-18 10:00 in New York.
const NOW = "2026-11-18T15:00:00.000Z";

function setup(captures: string[] = []) {
  let clock = NOW;
  let workerActive = false;
  const jobs = createInMemoryIngestionJobStore({ newId: randomUUID });
  const budgets = createInMemorySourceBudgetStore();
  const dependencies = {
    consensus: { captures: async () => captures },
    jobs,
    budgets,
    now: () => clock,
    workerActive: () => workerActive,
  };
  async function runOpenJob(execute: IngestionJobExecutor) {
    const [job] = await jobs.listJobs({
      sourceId: "alpha-vantage",
      statuses: ["open"],
      limit: 1,
    });
    return runIngestionJob(
      { jobId: job!.jobId, holder: "test-worker" },
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
    captures,
    runOpenJob,
    setClock: (next: string) => {
      clock = next;
    },
    setWorkerActive: (next: boolean) => {
      workerActive = next;
    },
  };
}

describe("assessConsensusFreshness", () => {
  it("is fresh with a capture of the same New York day, whatever the UTC date", () => {
    // 2026-11-18 23:30 in New York is already the 19th in UTC.
    expect(
      assessConsensusFreshness({
        captures: ["2026-11-19T04:30:00.000Z"],
        lastCheck: null,
        now: "2026-11-19T04:45:00.000Z",
        retryFailures: false,
      }).status,
    ).toBe("fresh");
    expect(
      assessConsensusFreshness({
        captures: ["2026-11-18T04:30:00.000Z"],
        lastCheck: null,
        now: NOW,
        retryFailures: false,
      }),
    ).toEqual({ status: "stale", capturedAt: "2026-11-18T04:30:00.000Z" });
  });

  it("does not replan a failure checked today unless the owner retries", () => {
    const lastCheck = { checkedAt: "2026-11-18T14:00:00.000Z", failed: true };
    expect(
      assessConsensusFreshness({
        captures: [],
        lastCheck,
        now: NOW,
        retryFailures: false,
      }).status,
    ).toBe("failed");
    expect(
      assessConsensusFreshness({
        captures: [],
        lastCheck,
        now: NOW,
        retryFailures: true,
      }).status,
    ).toBe("stale");
    expect(
      assessConsensusFreshness({
        captures: [],
        lastCheck: { ...lastCheck, checkedAt: "2026-11-17T14:00:00.000Z" },
        now: NOW,
        retryFailures: false,
      }).status,
    ).toBe("stale");
  });
});

describe("ensureConsensus", () => {
  it("plans one job for a due security, starts it once and reads fresh after", async () => {
    const { dependencies, jobs, captures, runOpenJob } = setup();

    const first = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(first.status).toEqual({
      state: "running",
      other: false,
      waitingUntil: null,
    });
    expect(first.runJobId).not.toBeNull();

    // A second call while the job is open plans nothing new.
    await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(
      await jobs.listJobs({ sourceId: "alpha-vantage", limit: 10 }),
    ).toHaveLength(1);

    await runOpenJob(async () => {
      captures.push(NOW);
      return { kind: "ingested", ingestionRunId: randomUUID() };
    });

    const after = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(after).toEqual({
      status: { state: "fresh", capturedAt: NOW },
      runJobId: null,
    });
  });

  it("names a failure and replans it only on retry", async () => {
    const { dependencies, runOpenJob } = setup();
    await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    await runOpenJob(async () => ({
      kind: "subject_rejected",
      message: "schema_changed",
    }));

    const failed = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(failed.status).toEqual({ state: "failed", capturedAt: null });

    const retried = await ensureConsensus(
      { securityId: SECURITY, retryFailures: true, credentialReady: true },
      dependencies,
    );
    expect(retried.status.state).toBe("running");
  });

  it("says the source is busy with another security without starting a second worker", async () => {
    const { dependencies, setWorkerActive } = setup();
    await ensureConsensus(
      { securityId: OTHER, retryFailures: false, credentialReady: true },
      dependencies,
    );
    setWorkerActive(true);
    const busy = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(busy).toEqual({
      status: { state: "running", other: true, waitingUntil: null },
      runJobId: null,
    });
  });

  it("plans nothing without the key, and says so", async () => {
    const { dependencies, jobs } = setup();
    const result = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: false },
      dependencies,
    );
    expect(result.status).toEqual({
      state: "blocked",
      reason: "credential_missing",
      resumesAt: null,
    });
    expect(
      await jobs.listJobs({ sourceId: "alpha-vantage", limit: 10 }),
    ).toHaveLength(0);
  });

  it("plans nothing when the owner stopped the source", async () => {
    const { dependencies, jobs } = setup();
    await dependencies.budgets.setControl({
      controlId: randomUUID(),
      sourceId: "alpha-vantage",
      status: "disabled",
      dailyRequestLimit: null,
      dailySpendLimitNanoUsd: null,
      reason: "prueba del owner",
      actor: "test",
      now: NOW,
    });
    const result = await ensureConsensus(
      { securityId: SECURITY, retryFailures: false, credentialReady: true },
      dependencies,
    );
    expect(result.status).toMatchObject({
      state: "blocked",
      reason: "source_disabled",
    });
    expect(
      await jobs.listJobs({ sourceId: "alpha-vantage", limit: 10 }),
    ).toHaveLength(0);
  });

  it("tells the render whether to call the action, without writing", async () => {
    const { dependencies, jobs } = setup(["2026-11-17T15:00:00.000Z"]);
    expect(
      await readConsensusReadiness({ securityId: SECURITY }, dependencies),
    ).toEqual({ needsRefresh: true, failed: false });
    expect(
      await jobs.listJobs({ sourceId: "alpha-vantage", limit: 10 }),
    ).toHaveLength(0);
  });
});

describe("classifyConsensusFailure", () => {
  it("keeps quota and refusals off the subject and a changed payload on it", () => {
    expect(
      classifyConsensusFailure(
        new ConsensusSourceError("rate_limited", "AAPL", "api_rate_limited"),
        null,
      ),
    ).toMatchObject({ kind: "source_signal", signal: "throttled" });
    expect(
      classifyConsensusFailure(
        new SourceRequestRefusedError("alpha-vantage", {
          status: "source_disabled",
          reason: "prueba del owner",
        }),
        null,
      ),
    ).toMatchObject({ kind: "source_signal", signal: "refused" });
    expect(
      classifyConsensusFailure(
        new ConsensusSourceError("schema_changed", "AAPL", "layout_changed"),
        null,
      ),
    ).toMatchObject({ kind: "subject_rejected" });
    expect(
      classifyConsensusFailure(
        new ConsensusSourceError("fetch_failed", "AAPL", "deadline_exceeded"),
        null,
      ),
    ).toMatchObject({ kind: "executor_error" });
    expect(() => classifyConsensusFailure(new Error("bug"), null)).toThrow(
      "bug",
    );
  });
});
