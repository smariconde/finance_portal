import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "personal" as "personal" | "locked",
  request: vi.fn(),
  start: vi.fn(),
  after: vi.fn(),
  security: vi.fn(),
  ensureConsensus: vi.fn(),
  startConsensus: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/config/app-environment", () => ({
  getRequestConfigHealth: async () => ({ mode: mocks.mode }),
}));
vi.mock("@/server/jobs/valuation-job", () => ({
  requestValuationForRequest: mocks.request,
  startValuationWorker: mocks.start,
}));

vi.mock("@/server/jobs/consensus-refresh", () => ({
  securityOfValuedTicker: mocks.security,
  ensureConsensusForRequest: mocks.ensureConsensus,
  startConsensusWorker: mocks.startConsensus,
}));

import { enqueueValuation, refreshConsensus } from "./actions";

const QUEUED = {
  state: "queued" as const,
  ticker: "AAPL",
  knownAt: "2026-10-21T15:00:00.000Z",
  gap: null,
  identityStatus: null,
  methodStatus: null,
  assetProfile: null,
  method: null,
  rigor: null,
  unsupportedReason: null,
  ruleVersion: "valuation-job-1.0.0" as const,
};

/**
 * Frontera de la corrida por ticker (`TM-03`): se prueba como un endpoint
 * público, invocado sin la UI.
 */
describe("enqueueValuation", () => {
  beforeEach(() => {
    mocks.mode = "personal";
    mocks.request.mockReset();
    mocks.start.mockReset();
    mocks.after.mockReset();
  });

  it("un runtime trabado se niega sin componer nada", async () => {
    mocks.mode = "locked";

    expect(
      await enqueueValuation({ ticker: "AAPL", intent: "enqueue" }),
    ).toEqual({ state: "unavailable" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    ["sin cuerpo", undefined],
    ["una URL", { ticker: "http://169.254.169.254", intent: "enqueue" }],
    ["un CIK", { ticker: "0000320193", intent: "enqueue" }],
    [
      "campos de más",
      { ticker: "AAPL", intent: "enqueue", url: "http://169.254.169.254/" },
    ],
    ["una intención ajena", { ticker: "AAPL", intent: "delete" }],
  ])("rechaza %s sin tocar la base", async (_label, input) => {
    expect(await enqueueValuation(input)).toEqual({ state: "unavailable" });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("arranca el worker después de responder, y consultar un job cerrado no lo arranca", async () => {
    mocks.request.mockResolvedValueOnce({
      view: QUEUED,
      runJobId: "11111111-1111-4111-8111-111111111111",
    });

    expect(
      await enqueueValuation({ ticker: "aapl", intent: "enqueue" }),
    ).toEqual(QUEUED);
    expect(mocks.request).toHaveBeenCalledWith({
      ticker: "AAPL",
      intent: "enqueue",
    });
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.after.mock.calls[0]![0]();
    expect(mocks.start).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );

    mocks.request.mockResolvedValueOnce({
      view: { ...QUEUED, state: "completed", gap: "unresolved_ticker" },
      runJobId: null,
    });
    await enqueueValuation({ ticker: "AAPL", intent: "status" });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("un error no sale de la frontera y el log no lleva su mensaje", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.request.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:55432 password=secret"),
    );

    expect(
      await enqueueValuation({ ticker: "AAPL", intent: "enqueue" }),
    ).toEqual({ state: "unavailable" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    consoleError.mockRestore();
  });
});

/** The consensus capture on open (`F6-29`, `TM-03`), invoked without the UI. */
describe("refreshConsensus", () => {
  const SECURITY = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    mocks.mode = "personal";
    mocks.security.mockReset();
    mocks.ensureConsensus.mockReset();
    mocks.startConsensus.mockReset();
    mocks.after.mockReset();
  });

  it("refuses in a locked runtime without composing anything", async () => {
    mocks.mode = "locked";
    expect(
      await refreshConsensus({ ticker: "AAPL", retryFailures: false }),
    ).toEqual({ state: "unavailable" });
    expect(mocks.security).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["a URL", { ticker: "http://169.254.169.254", retryFailures: false }],
    ["an extra field", { ticker: "AAPL", retryFailures: false, url: "x" }],
    ["a missing boolean", { ticker: "AAPL" }],
  ])("refuses %s", async (_label, input) => {
    expect(await refreshConsensus(input)).toEqual({ state: "unavailable" });
    expect(mocks.ensureConsensus).not.toHaveBeenCalled();
  });

  it("captures only a ticker with a recorded valuation run", async () => {
    mocks.security.mockResolvedValue(null);
    expect(
      await refreshConsensus({ ticker: "ZZZZ", retryFailures: false }),
    ).toEqual({ state: "unavailable" });
    expect(mocks.ensureConsensus).not.toHaveBeenCalled();
  });

  it("starts the worker after answering and returns only the state", async () => {
    mocks.security.mockResolvedValue(SECURITY);
    mocks.ensureConsensus.mockResolvedValue({
      status: { state: "running", other: false, waitingUntil: null },
      runJobId: "job-1",
    });
    expect(
      await refreshConsensus({ ticker: "aapl", retryFailures: true }),
    ).toEqual({ state: "running", other: false, waitingUntil: null });
    expect(mocks.security).toHaveBeenCalledWith("AAPL");
    expect(mocks.ensureConsensus).toHaveBeenCalledWith({
      securityId: SECURITY,
      retryFailures: true,
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("hides a failure's message", async () => {
    mocks.security.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.1"),
    );
    const result = await refreshConsensus({
      ticker: "AAPL",
      retryFailures: false,
    });
    expect(result).toEqual({ state: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("10.0.0.1");
  });
});
