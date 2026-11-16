import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  load: vi.fn(),
  factory: vi.fn(),
}));
vi.mock("@/server/config/app-environment", () => ({
  getRequestConfigHealth: mocks.health,
}));
vi.mock("@/modules/configuration/domain/config-health", () => ({
  servesRealData: (health: { mode: string }) => health.mode === "personal",
}));
vi.mock("@/server/company-logos/load-company-logo", () => ({
  getCompanyLogoLoader: mocks.factory,
}));

import { GET } from "./route";

const call = (ticker = "KO", query = "", headers = {}) =>
  GET(
    new Request(
      `http://localhost/api/company-logos/${encodeURIComponent(ticker)}${query}`,
      { headers },
    ),
    { params: Promise.resolve({ ticker }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.health.mockResolvedValue({ mode: "personal" });
  mocks.factory.mockReturnValue(mocks.load);
  mocks.load.mockResolvedValue({
    state: "stored",
    logo: { bytes: new Uint8Array([1, 2, 3]), contentHash: "a".repeat(64) },
  });
});
describe("company logo HTTP boundary", () => {
  it("refuses a locked runtime before creating storage or egress", async () => {
    mocks.health.mockResolvedValue({ mode: "locked" });
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("rejects traversal and query-controlled destinations before storage", async () => {
    expect((await call("../KO")).status).toBe(400);
    expect((await call("KO", "?url=https://evil.invalid/logo")).status).toBe(
      400,
    );
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("serves PNG bytes with private browser caching and an ETag", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=86400",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(
      (await call("KO", "", { "if-none-match": `"${"a".repeat(64)}"` })).status,
    ).toBe(304);
  });
  it("degrades without leaking dependency errors or caching failures", async () => {
    mocks.load.mockRejectedValue(
      new Error("postgres://secret:password@private"),
    );
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
    mocks.load.mockResolvedValue({ state: "missing" });
    expect((await call()).status).toBe(404);
    mocks.load.mockResolvedValue({ state: "unavailable" });
    expect((await call()).status).toBe(503);
  });
});
