import { describe, expect, it, vi } from "vitest";

import {
  createPacedEgressFetch,
  RequestBudgetExhaustedError,
  type EgressFetch,
} from "./egress-fetch";

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];

  return {
    sleeps,
    clock: {
      elapsedMs: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function okFetch(): EgressFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    status: 200,
    body: new Uint8Array(),
    byteLength: 0,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  }));
}

const request = { sourceId: "sec-edgar", url: "https://data.sec.gov/x" };

describe("createPacedEgressFetch", () => {
  it("spaces consecutive calls by the minimum interval", async () => {
    const time = fakeClock();
    const paced = createPacedEgressFetch(
      okFetch(),
      { minIntervalMs: 500, maxRequests: 10 },
      time.clock,
    );

    await paced(request);
    time.advance(120);
    await paced(request);
    await paced(request);

    expect(time.sleeps).toStrictEqual([380, 500]);
  });

  it("does not wait when enough time already passed", async () => {
    const time = fakeClock();
    const paced = createPacedEgressFetch(
      okFetch(),
      { minIntervalMs: 500, maxRequests: 10 },
      time.clock,
    );

    await paced(request);
    time.advance(900);
    await paced(request);

    expect(time.sleeps).toStrictEqual([]);
  });

  it("runs calls one at a time even when fired together", async () => {
    const time = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetch: EgressFetch = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return {
        status: 200,
        body: new Uint8Array(),
        byteLength: 0,
        fetchedAt: "2026-09-14T12:00:00.000Z",
      };
    };
    const paced = createPacedEgressFetch(
      fetch,
      { minIntervalMs: 0, maxRequests: 10 },
      time.clock,
    );

    await Promise.all([paced(request), paced(request), paced(request)]);

    expect(maxInFlight).toBe(1);
  });

  it("refuses the call past the budget before reaching the network", async () => {
    const fetch = okFetch();
    const paced = createPacedEgressFetch(
      fetch,
      { minIntervalMs: 0, maxRequests: 2 },
      fakeClock().clock,
    );

    await paced(request);
    await paced(request);

    await expect(paced(request)).rejects.toBeInstanceOf(
      RequestBudgetExhaustedError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(paced.requestCount()).toBe(2);
  });

  it("counts a failed call against the budget and keeps the queue moving", async () => {
    const fetch = vi
      .fn<EgressFetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({
        status: 200,
        body: new Uint8Array(),
        byteLength: 0,
        fetchedAt: "2026-09-14T12:00:00.000Z",
      });
    const paced = createPacedEgressFetch(
      fetch,
      { minIntervalMs: 0, maxRequests: 5 },
      fakeClock().clock,
    );

    await expect(paced(request)).rejects.toThrow("socket hang up");
    await expect(paced(request)).resolves.toMatchObject({ status: 200 });
    expect(paced.requestCount()).toBe(2);
  });
});
