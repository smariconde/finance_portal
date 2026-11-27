import { afterEach, describe, expect, it, vi } from "vitest";

import { TradingDeadlineError, withTradingDeadline } from "./deadline";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withTradingDeadline", () => {
  it("returns what the read returns in time", async () => {
    await expect(
      withTradingDeadline("read", async () => "value", 1_000),
    ).resolves.toBe("value");
  });

  it("names the read that never came back instead of waiting forever", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = withTradingDeadline(
      "readAccountRisk.read",
      () => new Promise<never>(() => {}),
      20_000,
    );
    const outcome =
      expect(pending).rejects.toBeInstanceOf(TradingDeadlineError);
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
    expect(log).toHaveBeenCalledWith(
      "trading read deadline",
      "readAccountRisk.read",
      20_000,
    );
  });

  it("passes the read's own failure through", async () => {
    await expect(
      withTradingDeadline("read", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
