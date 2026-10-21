import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryValuationJobStore } from "../infrastructure/in-memory-valuation-job-store";
import {
  outcomeForIdentity,
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
    ).toEqual({ status: "completed", errorName: null });
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
});
