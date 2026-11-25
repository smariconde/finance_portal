import { describe, expect, it, vi } from "vitest";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import type { SourceRequestVerdict } from "@/modules/ingestion/domain/source-budget";
import { parseMcpAccessToken } from "@/modules/owner-mcp/domain/mcp-access-token";

import {
  handleOwnerMcpRequest,
  PORTAL_MCP_SOURCE_ID,
  type OwnerMcpRequestDependencies,
} from "./handle-owner-mcp-request";
import type { OwnerMcpReaders } from "./owner-mcp-server";

const TOKEN = Buffer.alloc(32, 5).toString("base64url");
const DIGEST = (() => {
  const parsed = parseMcpAccessToken(TOKEN);
  if (!parsed.ok) throw new Error("fixture token must parse");
  return parsed.digest;
})();
const PERSONAL = getConfigHealth({
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: "postgres://pooled",
  MCP_ACCESS_TOKEN: TOKEN,
});

const READERS: OwnerMcpReaders = {
  listValuations: async () => ({
    version: "valued-companies-1.0.0" as never,
    companies: [],
  }),
  getValuation: async (ticker) => ({ state: "not_requested", ticker }),
  readJournal: null,
  readTrade: null,
};

function dependencies(
  overrides: Partial<OwnerMcpRequestDependencies> = {},
): OwnerMcpRequestDependencies & { readonly logs: unknown[] } {
  const logs: unknown[] = [];
  return {
    health: PERSONAL,
    tokenDigest: DIGEST,
    allowedHostnames: ["localhost", "127.0.0.1"],
    budget: {
      consume: async (): Promise<SourceRequestVerdict> => ({
        status: "allowed",
        used: 1,
        remaining: 499,
      }),
    },
    readers: () => READERS,
    registry: DEMO_SOURCE_REGISTRY,
    requestId: "req-1",
    now: () => 0,
    clock: () => "2026-11-16T12:00:00.000Z",
    log: (entry) => logs.push(entry),
    logs,
    ...overrides,
  };
}

function rpc(
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request("http://127.0.0.1:3000/mcp", {
    method,
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

/** El tramo 2025 sin estado responde un frame SSE; el moderno, JSON. */
async function rpcBody(response: Response) {
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("");
  return JSON.parse(data);
}

const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

function call(name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

describe("handleOwnerMcpRequest", () => {
  it("sólo admite POST", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(null, {}, "GET"),
      dependencies(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("x-request-id")).toBe("req-1");
  });

  it("un runtime trabado responde 404 sin construir lecturas (`TM-01`)", async () => {
    const readers = vi.fn(() => READERS);
    const consume = vi.fn();
    const response = await handleOwnerMcpRequest(
      rpc(LIST),
      dependencies({
        health: getConfigHealth({ MCP_ACCESS_TOKEN: TOKEN }),
        readers,
        budget: { consume },
      }),
    );

    expect(response.status).toBe(404);
    expect(readers).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("sin token configurado la ruta no existe", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(LIST),
      dependencies({ tokenDigest: null }),
    );

    expect(response.status).toBe(404);
  });

  it("rechaza un navegador por su Origin (`TM-12`)", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(LIST, { origin: "https://evil.example" }),
      dependencies(),
    );

    expect(response.status).toBe(403);
  });

  it("rechaza un Host fuera de la lista", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(LIST, { host: "rebinding.example" }),
      dependencies(),
    );

    expect(response.status).toBe(403);
  });

  it("sin el token o con otro responde 401 y no gasta cuota", async () => {
    const consume = vi.fn();
    for (const authorization of ["", "Bearer nope", `Basic ${TOKEN}`]) {
      const response = await handleOwnerMcpRequest(
        rpc(LIST, { authorization }),
        dependencies({ budget: { consume } }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
    expect(consume).not.toHaveBeenCalled();
  });

  it("cuenta cada pedido en `portal-mcp` y respeta el tope y el kill switch", async () => {
    const consume = vi.fn(async (): Promise<SourceRequestVerdict> => ({
      status: "daily_budget_exhausted",
      limit: 500,
      used: 500,
      resumesAt: "2026-11-17T00:00:00.000Z",
    }));
    const exhausted = await handleOwnerMcpRequest(
      rpc(LIST),
      dependencies({ budget: { consume } }),
    );

    expect(consume).toHaveBeenCalledWith(
      PORTAL_MCP_SOURCE_ID,
      "2026-11-16T12:00:00.000Z",
    );
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers.get("retry-after")).toBe("43200");

    const disabled = await handleOwnerMcpRequest(
      rpc(LIST),
      dependencies({
        budget: {
          consume: async () => ({ status: "source_disabled", reason: "x" }),
        },
      }),
    );
    expect(disabled.status).toBe(503);
  });

  it("sin poder contar la cuota no sirve, y no dice por qué", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(LIST),
      dependencies({
        budget: {
          consume: async () => {
            throw new Error("connect ECONNREFUSED sentinel-budget-host");
          },
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sentinel-budget-host");
  });

  it("lista el catálogo, todas de sólo lectura", async () => {
    const response = await handleOwnerMcpRequest(rpc(LIST), dependencies());
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual(["get_trade", "get_valuation", "list_trades", "list_valuations"]);
    for (const tool of body.result.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("llama una herramienta y registra la llamada sin sus argumentos", async () => {
    const deps = dependencies();
    const response = await handleOwnerMcpRequest(
      rpc(call("get_valuation", { ticker: "aapl" })),
      deps,
    );
    const body = await rpcBody(response);
    const result = JSON.parse(body.result.content[0].text);

    expect(body.result.isError).not.toBe(true);
    expect(result).toMatchObject({
      catalogVersion: "portal-mcp-tools-1.2.0",
      ticker: "AAPL",
      state: "not_requested",
    });
    expect(deps.logs).toContainEqual(
      expect.objectContaining({
        requestId: "req-1",
        tool: "get_valuation",
        outcome: "ok",
      }),
    );
    expect(JSON.stringify(deps.logs)).not.toContain("aapl");
  });

  it("rechaza argumentos fuera del schema cerrado (`TM-07`)", async () => {
    for (const args of [
      { ticker: "AAPL; DROP TABLE" },
      { ticker: "AAPL", sql: "select 1" },
    ]) {
      const response = await handleOwnerMcpRequest(
        rpc(call("get_valuation", args)),
        dependencies(),
      );
      const body = await rpcBody(response);

      expect(body.error ?? body.result?.isError).toBeTruthy();
    }
  });

  it("sin base de trading el diario lo dice y el resto sirve", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(call("list_trades", {})),
      dependencies(),
    );
    const body = await rpcBody(response);

    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      error: "trading_unavailable",
      requestId: "req-1",
    });
  });

  it("una lectura que falla devuelve su código, nunca el mensaje", async () => {
    const response = await handleOwnerMcpRequest(
      rpc(call("list_valuations", {})),
      dependencies({
        readers: () => ({
          ...READERS,
          listValuations: async () => {
            throw new Error("connect ECONNREFUSED 10.0.0.7:5432 sentinel-host");
          },
        }),
      }),
    );
    const text = await response.text();

    expect(text).toContain("read_failed");
    expect(text).not.toContain("sentinel-host");
    expect(text).not.toContain("ECONNREFUSED");
  });
});
