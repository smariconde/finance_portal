import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryValuationJobStore } from "../infrastructure/in-memory-valuation-job-store";
import { VALUATION_DATA_RULE_VERSION } from "../domain/valuation-data-step";
import { VALUATION_QUALITATIVE_RULE_VERSION } from "../domain/valuation-qualitative-step";
import {
  outcomeForDataStep,
  outcomeForIdentity,
  outcomeForQualitativeStep,
  VALUATION_JOB_HEARTBEAT_MS,
  type ValuationJob,
  type ValuationJobOutcome,
} from "../domain/valuation-job";
import { requestValuationJob, runValuationJob } from "./request-valuation-job";

const T0 = "2026-10-21T15:00:00.000Z";

function harness(
  assess: (job: ValuationJob) => Promise<ValuationJobOutcome> = async () =>
    outcomeForIdentity("not_found"),
) {
  let clock = Date.parse(T0);
  const store = createInMemoryValuationJobStore();

  return {
    store,
    assess,
    dependencies: {
      store,
      now: () => new Date(clock).toISOString(),
      newId: () => randomUUID(),
      assess,
    },
    advance(milliseconds: number) {
      clock += milliseconds;
    },
  };
}

describe("requestValuationJob", () => {
  it("encola una vez y la consulta no crea otra", async () => {
    const { dependencies } = harness();
    const first = await requestValuationJob(
      { ticker: "aapl", intent: "enqueue" },
      dependencies,
    );
    const again = await requestValuationJob(
      { ticker: "AAPL", intent: "enqueue" },
      dependencies,
    );
    const status = await requestValuationJob(
      { ticker: "aapl", intent: "status" },
      dependencies,
    );

    expect(first.view).toMatchObject({ state: "queued", ticker: "AAPL" });
    expect(again.runJobId).toBe(first.runJobId);
    expect(status.runJobId).toBe(first.runJobId);
    expect(status.view).toMatchObject({ state: "queued" });
  });

  it("sin pedido, status queda idle y no escribe", async () => {
    const { dependencies, store } = harness();
    const status = await requestValuationJob(
      { ticker: "msft", intent: "status" },
      dependencies,
    );

    expect(status).toEqual({ view: { state: "idle" }, runJobId: null });
    expect(await store.findLatestByTicker("MSFT")).toBeNull();
  });

  it("el worker cierra con el hueco de la evaluación y una falla no deja el ticker tomado", async () => {
    const box = harness(async () => outcomeForIdentity("not_found"));
    const requested = await requestValuationJob(
      { ticker: "nvda", intent: "enqueue" },
      box.dependencies,
    );

    expect(
      await runValuationJob(requested.runJobId!, box.dependencies),
    ).toEqual({ status: "completed", errorName: null, followUpJobId: null });
    expect(
      await requestValuationJob(
        { ticker: "nvda", intent: "status" },
        box.dependencies,
      ),
    ).toMatchObject({
      view: { state: "completed", gap: "unresolved_ticker" },
      runJobId: null,
    });

    const failing = harness(async () => {
      throw new Error("connect ECONNREFUSED password=secret");
    });
    const broken = await requestValuationJob(
      { ticker: "nvda", intent: "enqueue" },
      failing.dependencies,
    );
    const run = await runValuationJob(broken.runJobId!, failing.dependencies);

    expect(run.status).toBe("failed");
    expect(run.errorName).toBe("Error");
    expect(JSON.stringify(run)).not.toContain("secret");
    const retry = await requestValuationJob(
      { ticker: "nvda", intent: "enqueue" },
      failing.dependencies,
    );
    expect(retry.view).toMatchObject({ state: "queued" });
    expect(retry.runJobId).not.toBe(broken.runJobId);
  });

  it("un job que bajó datos se cierra encolando el que lo continúa, con corte nuevo", async () => {
    const seen: ValuationJob[] = [];
    const box = harness(async (job) => {
      seen.push(job);
      box.advance(5_000);

      return outcomeForDataStep(
        {
          legalEntityId: "33333333-3333-4333-8333-333333333333",
          securityId: null,
          listingId: null,
        },
        "data_ingested",
        {
          ruleVersion: VALUATION_DATA_RULE_VERSION,
          fundamentals: { status: "ingested", filers: 1 },
          sic: { status: "present" },
          prices: { status: "not_applicable" },
          audit: { status: "passed", chains: 3, notExercised: [] },
        },
      );
    });
    const requested = await requestValuationJob(
      { ticker: "msft", intent: "enqueue" },
      box.dependencies,
    );
    const first = await runValuationJob(requested.runJobId!, box.dependencies);

    expect(first.status).toBe("completed");
    expect(first.followUpJobId).not.toBeNull();

    const open = await box.store.findOpenByTicker("MSFT");

    expect(open).toMatchObject({
      jobId: first.followUpJobId,
      status: "queued",
      followsJobId: requested.runJobId,
    });
    expect(Date.parse(open!.knownAt)).toBeGreaterThan(
      Date.parse(seen[0]!.knownAt),
    );
    // Consultar sigue al job que continúa: la página no tiene que saberlo.
    expect(
      await requestValuationJob(
        { ticker: "msft", intent: "status" },
        box.dependencies,
      ),
    ).toMatchObject({
      view: { state: "queued", follows: true },
      runJobId: first.followUpJobId,
    });
  });

  it("una decisión aceptada de la IA también se continúa con corte nuevo", async () => {
    const box = harness(async () => {
      box.advance(5_000);

      return outcomeForQualitativeStep(
        {
          legalEntityId: "33333333-3333-4333-8333-333333333333",
          securityId: null,
          listingId: null,
        },
        {
          ruleVersion: VALUATION_DATA_RULE_VERSION,
          fundamentals: { status: "present" },
          sic: { status: "present" },
          prices: { status: "not_applicable" },
          audit: { status: "passed", chains: 3, notExercised: [] },
        },
        {
          ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
          industry: { status: "accepted", rung: 1 },
          employeeEquity: { status: "present" },
          operationsMix: { status: "abstained", reason: "ladder_exhausted" },
          chargedNanoUsd: 2_600_000,
        },
      );
    });
    const requested = await requestValuationJob(
      { ticker: "googl", intent: "enqueue" },
      box.dependencies,
    );
    const first = await runValuationJob(requested.runJobId!, box.dependencies);

    expect(first.followUpJobId).not.toBeNull();
    expect(await box.store.findOpenByTicker("GOOGL")).toMatchObject({
      jobId: first.followUpJobId,
      followsJobId: requested.runJobId,
    });
  });

  it("late mientras evalúa y deja de latir al terminar", async () => {
    const beats: Array<() => Promise<void>> = [];
    let stopped = 0;
    const box = harness(async (job) => {
      box.advance(1_000);
      await beats[0]!();
      expect(
        (await box.store.findOpenByTicker(job.ticker))?.heartbeatAt,
      ).not.toBeNull();

      return outcomeForIdentity("not_found");
    });
    const requested = await requestValuationJob(
      { ticker: "aapl", intent: "enqueue" },
      box.dependencies,
    );

    await runValuationJob(requested.runJobId!, {
      ...box.dependencies,
      startHeartbeat: (beat, intervalMs) => {
        expect(intervalMs).toBe(VALUATION_JOB_HEARTBEAT_MS);
        beats.push(beat);
        return () => {
          stopped += 1;
        };
      },
    });

    expect(beats).toHaveLength(1);
    expect(stopped).toBe(1);
  });
});
