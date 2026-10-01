import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: "personal" as "personal" | "locked",
  loadMatrix: vi.fn(),
  serialize: vi.fn(),
  getUniverse: vi.fn(),
  getClassifications: vi.fn(),
  getPrices: vi.fn(),
  getCedears: vi.fn(),
}));

vi.mock("@/server/config/app-environment", () => ({
  getRequestConfigHealth: async () => ({ mode: mocks.mode }),
}));
vi.mock("@/server/persistence/get-universe-repository", () => ({
  getUniverseRepository: mocks.getUniverse,
}));
vi.mock("@/server/persistence/get-classification-repository", () => ({
  getClassificationRepository: mocks.getClassifications,
}));
vi.mock("@/server/persistence/get-price-repository", () => ({
  getPriceRepository: mocks.getPrices,
}));
vi.mock("@/server/persistence/get-cedear-registry-repository", () => ({
  getCedearRegistryRepository: mocks.getCedears,
}));
vi.mock(
  "@/modules/metrics/application/load-sector-risk-matrix",
  async (importOriginal) => ({
    ...(await importOriginal()),
    loadSectorRiskMatrix: mocks.loadMatrix,
  }),
);
vi.mock(
  "@/modules/metrics/application/export-sector-risk-matrix",
  async (importOriginal) => ({
    ...(await importOriginal()),
    serializeSectorRiskMatrixCsv: mocks.serialize,
  }),
);

import { GET } from "./route";

function request(sector: string, search = "") {
  return GET(
    new Request(`http://localhost/sectores/${sector}/export${search}`),
    {
      params: Promise.resolve({ sector }),
    },
  );
}

describe("GET sector risk CSV", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T15:00:00.000Z"));
    mocks.mode = "personal";
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") mock.mockReset();
    }
    mocks.loadMatrix.mockResolvedValue({
      matrix: { asOf: "2026-09-30", points: [] },
    });
    mocks.serialize.mockReturnValue("sector,risk\r\nEnergy,1\r\n");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("denies a locked runtime before touching sources or the matrix", async () => {
    mocks.mode = "locked";
    const response = await request("energy");
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.loadMatrix).not.toHaveBeenCalled();
  });

  it("rejects an unknown sector and all query parameters before touching storage", async () => {
    expect((await request("crypto")).status).toBe(404);
    expect((await request("energy", "?asOf=2024-01-01")).status).toBe(400);
    expect(mocks.loadMatrix).not.toHaveBeenCalled();
  });

  it("returns a private attachment from a fresh server-side read", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await request("energy");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="riesgo-energy-2026-09-30.csv"',
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await response.text()).toBe("sector,risk\r\nEnergy,1\r\n");
    expect(mocks.loadMatrix).toHaveBeenCalledWith(
      { sectorCode: "energy", asOf: null },
      expect.objectContaining({ today: expect.any(Function) }),
    );
    expect(mocks.serialize).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Map),
      "2026-10-01T15:00:00.000Z",
    );
  });

  it("returns a generic failure without leaking dependency details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadMatrix.mockRejectedValue(new Error("postgres://secret-host"));
    const response = await request("energy");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Export no disponible.");
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("secret-host"),
    );
  });
});
