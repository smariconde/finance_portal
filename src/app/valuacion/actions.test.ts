import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "personal" as "personal" | "locked",
  request: vi.fn(),
  start: vi.fn(),
  after: vi.fn(),
  history: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/config/app-environment", () => ({
  getRequestConfigHealth: async () => ({ mode: mocks.mode }),
}));
vi.mock("@/server/jobs/valuation-job", () => ({
  requestValuationForRequest: mocks.request,
  startValuationWorker: mocks.start,
  readValuationHistoryForRequest: mocks.history,
}));

import { enqueueValuation, loadValuationHistory } from "./actions";

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

describe("loadValuationHistory", () => {
  beforeEach(() => {
    mocks.mode = "personal";
    mocks.history.mockReset();
  });

  it("un runtime trabado se niega sin leer la base", async () => {
    mocks.mode = "locked";

    expect(await loadValuationHistory({ ticker: "AAPL" })).toEqual({
      state: "unavailable",
    });
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it.each([
    ["sin cuerpo", undefined],
    ["una URL", { ticker: "http://169.254.169.254" }],
    ["un CIK", { ticker: "0000320193" }],
    ["un campo de más", { ticker: "AAPL", limit: 10_000 }],
    ["un intento", { ticker: "AAPL", intent: "enqueue" }],
  ])("rechaza %s sin repetir la entrada", async (_label, input) => {
    expect(await loadValuationHistory(input)).toEqual({
      state: "unavailable",
    });
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("normaliza el ticker y devuelve la vista del servicio", async () => {
    const view = {
      state: "history" as const,
      ticker: "AAPL",
      comparisonVersion: "valuation-run-comparison-1.0.0" as const,
      limit: 20,
      entries: [],
    };
    mocks.history.mockResolvedValue(view);

    expect(await loadValuationHistory({ ticker: " aapl " })).toEqual(view);
    expect(mocks.history).toHaveBeenCalledWith("AAPL");
  });

  it("una falla de la base es una negativa sin detalle", async () => {
    mocks.history.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await loadValuationHistory({ ticker: "AAPL" })).toEqual({
      state: "unavailable",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("10.0.0.1");
    errors.mockRestore();
  });
});
