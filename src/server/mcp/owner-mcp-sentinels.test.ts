import { afterEach, describe, expect, it, vi } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { parseMcpAccessToken } from "@/modules/owner-mcp/domain/mcp-access-token";
import { fixtureValuationReading } from "@/modules/owner-mcp/infrastructure/fixture-valuation-reading";
import { syntheticTrade } from "@/modules/trading/application/schwab-transaction-store.contract";
import { buildJournal } from "@/modules/trading/domain/journal";
import {
  tradeKeyOf,
  tradeRefOf,
} from "@/modules/trading/domain/trade-annotation";

import { handleOwnerMcpRequest } from "./handle-owner-mcp-request";
import type { OwnerMcpReaders } from "./owner-mcp-server";

/**
 * Ninguna herramienta devuelve un secreto, la clave de la cuenta ni un ID
 * interno (ADR 0078, sección 2, `TM-02`). Se llama cada herramienta del
 * catálogo con datos que contienen centinelas y se busca cada uno en lo que
 * sale por la ruta.
 */

const TOKEN = Buffer.alloc(32, 3).toString("base64url");
const ACCOUNT_KEY = "a".repeat(24) + "sentinelaccountkey" + "b".repeat(22);
const SENTINELS = {
  SCHWAB_APP_KEY: "SentinelSchwabAppKey0001",
  SCHWAB_APP_SECRET: "sentinel-schwab-app-secret",
  TRADING_SECRET_KEY: Buffer.alloc(32, 11).toString("base64"),
  DATABASE_URL: "postgres://sentinel-user:sentinel-pass@sentinel-host:5432/db",
  TRADING_DATABASE_URL:
    "postgres://sentinel-user:sentinel-pass@sentinel-trading:5432/trading",
  MCP_ACCESS_TOKEN: TOKEN,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function journal() {
  const fill = (id: string, quantity: string, net: string, time: string) =>
    syntheticTrade(id, {
      executedAt: time,
      netAmount: net,
      fees: "0.01",
      instrument: {
        instrumentId: "77",
        symbol: "SYN",
        assetType: "EQUITY",
        instrumentType: "COMMON_STOCK",
        description: null,
        quantity,
        price: "10",
        positionEffect: quantity.startsWith("-") ? "CLOSING" : "OPENING",
      },
    });
  return buildJournal(ACCOUNT_KEY, [
    fill("1", "10", "-100.01", "2026-11-09T15:00:00.000Z"),
    fill("2", "-10", "109.99", "2026-11-09T19:00:00.000Z"),
    fill("3", "5", "-50.01", "2026-11-10T15:00:00.000Z"),
  ]);
}

function request(name: string, args: Record<string, unknown>) {
  return new Request("http://127.0.0.1:3000/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

describe("salidas del MCP", () => {
  it("no contienen secretos, la clave de cuenta ni IDs internos", async () => {
    vi.stubEnv("APP_MODE", "personal");
    vi.stubEnv("APP_RUNTIME_ACCESS", "local");
    for (const [name, value] of Object.entries(SENTINELS)) {
      vi.stubEnv(name, value);
    }
    const { reading, run } = await fixtureValuationReading("fcff");
    expect(reading.state).toBe("run");
    const { trades, summary } = journal();
    const ref = tradeRefOf(tradeKeyOf(trades[0]!));

    const readers: OwnerMcpReaders = {
      listValuations: async () => ({
        version: "valued-companies-1.0.0" as never,
        companies: [],
      }),
      getValuation: async () => reading,
      readJournal: async () => ({
        account: { lastFour: "6789" },
        trades,
        summary,
        entries: Object.fromEntries(
          trades.map((trade) => [
            trade.tradeId,
            {
              ref: tradeRefOf(tradeKeyOf(trade)),
              setupCode: null,
              review: "pending" as const,
              r: { value: null, reason: "no_planned_stop" as const },
            },
          ]),
        ),
        lastSyncAt: "2026-11-16T12:00:00.000Z",
        historyFrom: "2025-11-16",
        unread: [],
      }),
      readTrade: async (candidate) =>
        candidate !== ref
          ? null
          : {
              lastFour: "6789",
              ref,
              trade: trades[0]!,
              annotation: null,
              linkedPlan: null,
              risk: { value: null, reason: "no_planned_stop" },
              r: { value: null, reason: "no_planned_stop" },
              rewardRisk: {
                value: null,
                entryBasis: null,
                reason: "no_stop",
              },
              unread: [],
            },
    };
    const digest = parseMcpAccessToken(TOKEN);
    if (!digest.ok) throw new Error("fixture token must parse");

    const bodies: string[] = [];
    for (const [name, args] of [
      ["list_valuations", {}],
      ["get_valuation", { ticker: "AAPL" }],
      ["list_trades", {}],
      ["get_trade", { ref }],
    ] as const) {
      const response = await handleOwnerMcpRequest(request(name, args), {
        health: getConfigHealth(process.env),
        tokenDigest: digest.digest,
        allowedHostnames: ["127.0.0.1"],
        budget: {
          consume: async () => ({ status: "allowed", used: 1, remaining: 1 }),
        },
        readers: () => readers,
        registry: DEMO_SOURCE_REGISTRY,
        requestId: "req-sentinel",
        now: () => 0,
        clock: () => "2026-11-16T12:00:00.000Z",
        log: () => undefined,
      });
      const text = await response.text();
      expect(text, name).not.toContain('\\"error\\"');
      bodies.push(text);
    }

    const all = bodies.join("\n");
    expect(all).toContain("SYN");
    expect(all).toContain("6789");
    for (const [name, value] of Object.entries(SENTINELS)) {
      expect(all, name).not.toContain(value);
    }
    for (const forbidden of [
      ACCOUNT_KEY,
      "sentinelaccountkey",
      "accountKey",
      run.valuationRunId,
      run.subject.legalEntityId,
      run.subject.securityId,
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});
