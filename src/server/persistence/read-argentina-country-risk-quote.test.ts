import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readState: vi.fn(), fetch: vi.fn() }));
vi.mock("./get-source-budget-store", () => ({
  getSourceBudgetStore: () => ({ readState: mocks.readState }),
}));
vi.mock("@/server/egress/get-source-egress-fetch", () => ({
  getSourceEgressFetch: () => mocks.fetch,
}));

function setSourceDate(date: string) {
  mocks.fetch.mockImplementation(async () => ({
    status: 200,
    fetchedAt: new Date().toISOString(),
    body: new TextEncoder().encode(
      JSON.stringify({
        ultimo: "944",
        fecha: date,
        variacion: "-2,3%",
        "class-variacion": "down-green",
      }),
    ),
  }));
}

describe("temporary country risk quote cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T02:58:00.000Z"));
    mocks.readState.mockReset().mockResolvedValue({ control: null });
    mocks.fetch.mockReset();
    setSourceDate("27-11-2026");
  });

  afterEach(() => vi.useRealTimers());

  it("coalesces concurrent visits and never reuses yesterday's quote after midnight in Buenos Aires", async () => {
    const { readArgentinaCountryRiskQuote } =
      await import("./read-argentina-country-risk-quote");
    const [first, second] = await Promise.all([
      readArgentinaCountryRiskQuote(),
      readArgentinaCountryRiskQuote(),
    ]);
    expect(first).toMatchObject({ on: "2026-11-27", value: "944" });
    expect(second).toEqual(first);
    vi.setSystemTime(new Date("2026-11-28T02:59:00.000Z"));
    expect(await readArgentinaCountryRiskQuote()).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-28T03:00:00.000Z"));
    setSourceDate("28-11-2026");
    expect(await readArgentinaCountryRiskQuote()).toMatchObject({
      on: "2026-11-28",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("respects the historical source's kill switch for new quote requests", async () => {
    const { readArgentinaCountryRiskQuote } =
      await import("./read-argentina-country-risk-quote");
    mocks.readState.mockResolvedValue({ control: { status: "disabled" } });
    expect(await readArgentinaCountryRiskQuote()).toBeNull();
    expect(mocks.readState).toHaveBeenCalledExactlyOnceWith(
      "ambito-riesgo-pais",
      "2026-11-28T02:58:00.000Z",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
