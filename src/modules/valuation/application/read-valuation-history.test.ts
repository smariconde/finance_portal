import { describe, expect, it } from "vitest";

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
import { readValuationHistory } from "./read-valuation-history";
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

describe("readValuationHistory", () => {
  it("compares each recorded run with the previous recorded one, newest first", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();
    const before = await runs.record(buildDemoValuationRunBeforeAmendment());
    const after = await runs.record(buildDemoValuationRun());
    const recorded = (valuationRunId: string) =>
      outcomeForAssessment(READING, { valuationRunId, runStatus: "computed" });

    await finished(jobs, recorded(before.valuationRunId));
    await finished(
      jobs,
      outcomeForAssessment(READING, { gap: "market_unavailable" }),
    );
    await finished(jobs, recorded(after.valuationRunId));
    await finished(jobs, recorded(after.valuationRunId));

    const view = await readValuationHistory({ ticker: "aapl" }, { jobs, runs });

    expect(view.state).toBe("history");
    if (view.state !== "history") return;

    expect(view.ticker).toBe("AAPL");
    expect(view.entries.map((entry) => entry.comparison?.kind ?? null)).toEqual(
      ["same_run", "changed", null, "first_run"],
    );
    expect(view.entries[1]?.comparison).toEqual({
      kind: "changed",
      cutoffChanged: true,
      sections: [
        "baseRevenue",
        "normalization",
        "capitalization",
        "failureRisk",
      ],
    });
    expect(view.entries[2]?.snapshotGap).toBe("market_unavailable");
    expect(JSON.stringify(view)).not.toContain(after.valuationRunId);
    expect(JSON.stringify(view)).not.toContain("valuePerShare");
  });

  it("lists nothing for a ticker without completed jobs, and keeps unresolved ones", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();

    expect(
      await readValuationHistory({ ticker: "AAPL" }, { jobs, runs }),
    ).toMatchObject({ state: "history", entries: [] });

    await finished(jobs, outcomeForIdentity("not_found"));

    const view = await readValuationHistory({ ticker: "AAPL" }, { jobs, runs });

    expect(view.state === "history" && view.entries[0]?.gap).toBe(
      "unresolved_ticker",
    );
    expect(view.state === "history" && view.entries[0]?.comparison).toBeNull();
  });

  it("never reads more than the history limit", async () => {
    const jobs = createInMemoryValuationJobStore();
    const runs = createInMemoryValuationRunRepository();

    for (let index = 0; index < 23; index += 1) {
      await finished(jobs, outcomeForIdentity("not_found"));
    }

    const view = await readValuationHistory({ ticker: "AAPL" }, { jobs, runs });

    expect(view.state === "history" && view.entries).toHaveLength(20);
  });
});
