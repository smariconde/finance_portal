import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";

import { readTradeChart } from "./trade-chart-service";

const NOW = "2026-05-10T15:00:00.000Z";

function egressDouble(answers: readonly { status?: number; body: string }[]): {
  egress: EgressFetch;
  requests: EgressFetchRequest[];
} {
  const requests: EgressFetchRequest[] = [];
  return {
    requests,
    egress: async (request) => {
      const { status = 200, body } = answers[requests.length]!;
      requests.push(request);
      const encoded = new TextEncoder().encode(body);
      return {
        status,
        body: encoded,
        byteLength: encoded.byteLength,
        fetchedAt: NOW,
      };
    },
  };
}

function trade(overrides: Partial<RoundTrip> = {}): RoundTrip {
  return {
    tradeId: "k:schwab:1:2",
    accountKey: "k",
    instrumentKey: "schwab:1",
    symbol: "SYN",
    assetType: "EQUITY",
    multiplier: "1",
    currency: "USD",
    direction: "long",
    status: "closed",
    openedAt: "2026-04-29T14:05:00.000Z",
    closedAt: "2026-04-29T14:59:00.000Z",
    openedSession: "2026-04-29",
    closedSession: "2026-04-29",
    dayTrade: true,
    entryQuantity: "5",
    openQuantity: "0",
    averageEntryPrice: "10",
    averageExitPrice: "11",
    realizedPnl: "5",
    fees: "0",
    portions: [
      {
        fillId: "2",
        side: "buy",
        role: "open",
        quantity: "5",
        price: "10",
        netAmount: "-50",
        executedAt: "2026-04-29T14:05:00.000Z",
        realizedPnl: null,
      },
    ],
    ...overrides,
  };
}

const minuteCandle = `{"open":10,"high":10.5,"low":9.5,"close":10,"volume":100,"datetime":${Date.parse("2026-04-29T14:05:00.000Z")}}`;
const dailyCandle = `{"open":10,"high":11,"low":9,"close":10,"volume":100,"datetime":${Date.parse("2026-04-29T05:00:00.000Z")}}`;

describe("readTradeChart", () => {
  it("draws a recent day trade in one GET to marketdata and places its fill", async () => {
    const double = egressDouble([
      { body: `{"symbol":"SYN","empty":false,"candles":[${minuteCandle}]}` },
    ]);
    const reading = await readTradeChart(
      { egress: double.egress, now: () => NOW },
      trade(),
    );

    expect(reading).toMatchObject({
      state: "read",
      resolution: { kind: "minute", minutes: 1 },
      fallback: null,
      requests: 1,
      markers: [{ candleIndex: 0, outsideCandle: false }],
    });
    expect(double.requests).toHaveLength(1);
    expect(double.requests[0]!.sourceId).toBe("schwab-marketdata");
    expect(double.requests[0]!.method).toBeUndefined();
    expect(double.requests[0]!.url).toMatch(
      /^https:\/\/api\.schwabapi\.com\/marketdata\/v1\/pricehistory\?symbol=SYN&/u,
    );
  });

  it("falls back once to daily candles when the minutes come back empty", async () => {
    const double = egressDouble([
      { body: `{"symbol":"SYN","empty":true,"candles":[]}` },
      { body: `{"symbol":"SYN","empty":false,"candles":[${dailyCandle}]}` },
    ]);
    const reading = await readTradeChart(
      { egress: double.egress, now: () => NOW },
      trade(),
    );

    expect(reading).toMatchObject({
      state: "read",
      resolution: { kind: "daily" },
      fallback: "intraday_empty",
      requests: 2,
      markers: [{ candleIndex: 0 }],
    });
  });

  it("fails with a closed code and never asks for an odd symbol", async () => {
    const http = egressDouble([{ status: 401, body: "{}" }]);
    expect(
      await readTradeChart({ egress: http.egress, now: () => NOW }, trade()),
    ).toEqual({ state: "failed", code: "http_401" });

    const odd = egressDouble([]);
    expect(
      await readTradeChart(
        { egress: odd.egress, now: () => NOW },
        trade({ symbol: "SYN&x=1" }),
      ),
    ).toEqual({ state: "failed", code: "symbol_not_chartable" });
    expect(odd.requests).toHaveLength(0);
  });
});
