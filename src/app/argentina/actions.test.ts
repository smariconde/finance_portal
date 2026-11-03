import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "personal" as "personal" | "locked",
  ensure: vi.fn(),
  start: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/config/app-environment", () => ({
  getRequestConfigHealth: async () => ({ mode: mocks.mode }),
}));
vi.mock("@/server/jobs/argentina-refresh", () => ({
  ensureArgentinaRefreshForRequest: mocks.ensure,
  startArgentinaRefreshWorker: mocks.start,
}));

import { refreshArgentinaData } from "./actions";

/**
 * Tested as a public endpoint (`TM-03`): invoked without the UI, with what
 * an attacker would send.
 */
describe("refreshArgentinaData", () => {
  beforeEach(() => {
    mocks.mode = "personal";
    mocks.ensure.mockReset();
    mocks.start.mockReset();
    mocks.after.mockReset();
  });

  it("a locked runtime refuses without composing anything", async () => {
    mocks.mode = "locked";
    expect(await refreshArgentinaData({ retryFailures: false })).toEqual({
      state: "unavailable",
    });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["a series of its own", { retryFailures: false, variable: 1 }],
    ["a URL", { retryFailures: false, url: "http://169.254.169.254/" }],
    ["a wrong type", { retryFailures: "yes" }],
  ])("refuses %s without touching the database", async (_label, input) => {
    expect(await refreshArgentinaData(input)).toEqual({ state: "unavailable" });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("starts the worker after answering, only when needed", async () => {
    const status = {
      state: "running",
      done: 0,
      total: 52,
      failed: 0,
      sources: ["BCRA"],
      waitingUntil: null,
    };
    mocks.ensure.mockResolvedValueOnce({ status, runWorker: true });
    expect(await refreshArgentinaData({ retryFailures: false })).toEqual(
      status,
    );
    expect(mocks.after).toHaveBeenCalledTimes(1);

    mocks.ensure.mockResolvedValueOnce({
      status: { state: "fresh", failedSources: [] },
      runWorker: false,
    });
    await refreshArgentinaData({ retryFailures: false });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("answers without a message when the database fails", async () => {
    mocks.ensure.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.0.1:5432"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await refreshArgentinaData({ retryFailures: false })).toEqual({
      state: "unavailable",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("10.0.0.1");
    spy.mockRestore();
  });
});
