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
vi.mock("@/server/jobs/sector-price-refresh", () => ({
  ensureSectorPricesForRequest: mocks.ensure,
  startPriceRefreshWorker: mocks.start,
}));

import { refreshSectorPrices } from "./actions";

/**
 * La primera Server Action del proyecto (`TM-03`): se prueba como un endpoint
 * público, invocado sin la UI y con lo que un atacante mandaría.
 */
describe("refreshSectorPrices", () => {
  beforeEach(() => {
    mocks.mode = "personal";
    mocks.ensure.mockReset();
    mocks.start.mockReset();
    mocks.after.mockReset();
  });

  it("un runtime trabado se niega sin componer nada", async () => {
    mocks.mode = "locked";

    expect(
      await refreshSectorPrices({ sectorCode: "energy", retryFailures: false }),
    ).toEqual({ state: "unavailable" });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it.each([
    ["sin cuerpo", undefined],
    [
      "un sector fuera de la taxonomía",
      { sectorCode: "crypto", retryFailures: false },
    ],
    ["un ticker libre", { sectorCode: "AAPL", retryFailures: false }],
    [
      "campos de más",
      {
        sectorCode: "energy",
        retryFailures: false,
        url: "http://169.254.169.254/",
      },
    ],
    ["un tipo equivocado", { sectorCode: "energy", retryFailures: "yes" }],
  ])("rechaza %s sin tocar la base", async (_label, input) => {
    expect(await refreshSectorPrices(input)).toEqual({ state: "unavailable" });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("arranca el worker después de responder, sólo si hace falta", async () => {
    const status = {
      state: "running",
      jobId: "11111111-1111-4111-8111-111111111111",
      phase: "securities",
      done: 0,
      total: 3,
      failed: 0,
      waitingUntil: null,
    };
    mocks.ensure.mockResolvedValueOnce({
      status,
      runJobId: status.jobId,
    });

    expect(
      await refreshSectorPrices({ sectorCode: "energy", retryFailures: false }),
    ).toEqual(status);
    expect(mocks.ensure).toHaveBeenCalledWith({
      sectorCode: "energy",
      retryFailures: false,
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();

    mocks.after.mock.calls[0]![0]();
    expect(mocks.start).toHaveBeenCalledWith(status.jobId);

    mocks.ensure.mockResolvedValueOnce({ status, runJobId: null });
    await refreshSectorPrices({ sectorCode: "energy", retryFailures: false });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("un error no sale de la frontera y el log no lleva su mensaje", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.ensure.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 127.0.0.1:55432 password=secret"),
    );

    const result = await refreshSectorPrices({
      sectorCode: "energy",
      retryFailures: false,
    });

    expect(result).toEqual({ state: "unavailable" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    consoleError.mockRestore();
  });
});
