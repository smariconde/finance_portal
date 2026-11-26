import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";

import { readMarketHoursCheck } from "./market-hours-service";

function respond(status: number, value: unknown) {
  return {
    status,
    body: new TextEncoder().encode(JSON.stringify(value)),
    fetchedAt: "2026-11-26T15:00:00.000Z",
  };
}

const closed = (date: string) => ({
  equity: {
    equity: { date, marketType: "EQUITY", isOpen: false },
  },
});

const earlyClose = {
  equity: {
    EQ: {
      date: "2026-11-27",
      marketType: "EQUITY",
      isOpen: true,
      sessionHours: {
        regularMarket: [
          {
            start: "2026-11-27T09:30:00-05:00",
            end: "2026-11-27T13:00:00-05:00",
          },
        ],
      },
    },
  },
};

describe("readMarketHoursCheck", () => {
  it("asks Schwab for today and the next session and compares both", async () => {
    const urls: string[] = [];
    const egress = (async (request: EgressFetchRequest) => {
      urls.push(request.url);
      return request.url.includes("2026-11-26")
        ? respond(200, closed("2026-11-26"))
        : respond(200, earlyClose);
    }) as unknown as EgressFetch;

    const result = await readMarketHoursCheck({
      egress,
      now: () => "2026-11-26T15:00:00.000Z",
    });

    expect(urls).toEqual([
      "https://api.schwabapi.com/marketdata/v1/markets?markets=equity&date=2026-11-26",
      "https://api.schwabapi.com/marketdata/v1/markets?markets=equity&date=2026-11-27",
    ]);
    expect(result).toMatchObject({
      state: "read",
      requests: 2,
      days: [
        { date: "2026-11-26", matches: true },
        {
          date: "2026-11-27",
          matches: true,
          broker: { regular: { open: "11:30", close: "15:00" } },
        },
      ],
    });
  });

  it("asks once before the open, when the next session is today", async () => {
    let calls = 0;
    const egress = (async () => {
      calls += 1;
      return respond(200, earlyClose);
    }) as unknown as EgressFetch;

    await readMarketHoursCheck({
      egress,
      now: () => "2026-11-27T12:00:00.000Z",
    });
    expect(calls).toBe(1);
  });

  it("names an HTTP failure and stops", async () => {
    const egress = (async () => respond(401, {})) as unknown as EgressFetch;
    expect(
      await readMarketHoursCheck({
        egress,
        now: () => "2026-11-26T15:00:00.000Z",
      }),
    ).toEqual({ state: "failed", code: "http_401", path: null });
  });
});
