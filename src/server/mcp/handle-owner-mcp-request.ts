import "server-only";

import {
  createMcpHandler,
  hostHeaderValidationResponse,
} from "@modelcontextprotocol/server";

import {
  servesOwnerMcp,
  type ConfigHealth,
} from "@/modules/configuration/domain/config-health";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import { bearerMatches } from "@/modules/owner-mcp/domain/mcp-access-token";

import {
  createOwnerMcpServer,
  type OwnerMcpReaders,
  type ToolCallLog,
} from "./owner-mcp-server";

/**
 * La «fuente» que cuenta las llamadas del MCP en el presupuesto diario
 * (ADR 0020): no sale a la red, pero un loop del asistente no puede agotar la
 * Function ni la transferencia de Neon (`TM-10`), y el owner la frena con
 * `pnpm ingestion:sources --source portal-mcp --disable`.
 */
export const PORTAL_MCP_SOURCE_ID = "portal-mcp";

/** Un pedido JSON-RPC del asistente es chico; nada justifica más. */
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export type OwnerMcpRequestDependencies = {
  readonly health: ConfigHealth;
  /** SHA-256 del token, o `null` si no hay uno válido. */
  readonly tokenDigest: Buffer | null;
  readonly allowedHostnames: readonly string[];
  readonly budget: Pick<SourceBudgetStore, "consume">;
  /** Construye las lecturas sólo después de las dos puertas. */
  readonly readers: (health: ConfigHealth) => OwnerMcpReaders;
  readonly registry: readonly SourceRegistryEntry[];
  readonly requestId: string;
  readonly now: () => number;
  readonly clock: () => string;
  readonly log: (entry: ToolCallLog | RequestLog) => void;
};

export type RequestLog = {
  readonly requestId: string;
  readonly event: "mcp_request";
  readonly status: number;
  readonly outcome: string;
  readonly durationMs: number;
};

function plain(status: number, body: string, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

/**
 * La ruta `/mcp` (ADR 0078, secciones 4 y 5), en este orden:
 *
 * 1. sólo `POST`;
 * 2. un runtime que no sirve datos o sin token responde `404`, sin abrir una
 *    base (`TM-01`) —la ruta no existe para él—;
 * 3. un header `Origin` es un navegador: `403` (CSRF, DNS rebinding);
 * 4. `Host` fuera de la lista: `403`;
 * 5. sin el token: `401`, comparado en tiempo constante;
 * 6. el tope diario y el kill switch de `portal-mcp`;
 * 7. el SDK, sin estado: un servidor por pedido.
 *
 * Toda respuesta lleva el `X-Request-Id` y nunca un detalle interno.
 */
export async function handleOwnerMcpRequest(
  request: Request,
  dependencies: OwnerMcpRequestDependencies,
): Promise<Response> {
  const startedAt = dependencies.now();
  const finish = (response: Response, outcome: string) => {
    dependencies.log({
      requestId: dependencies.requestId,
      event: "mcp_request",
      status: response.status,
      outcome,
      durationMs: Math.max(0, Math.round(dependencies.now() - startedAt)),
    });
    response.headers.set("X-Request-Id", dependencies.requestId);
    return response;
  };

  if (request.method !== "POST") {
    return finish(
      plain(405, "Method not allowed.", { Allow: "POST" }),
      "method_not_allowed",
    );
  }

  if (
    !servesOwnerMcp(dependencies.health) ||
    dependencies.tokenDigest === null
  ) {
    return finish(plain(404, "Not found."), "not_served");
  }

  if (request.headers.has("origin")) {
    return finish(plain(403, "Forbidden."), "origin_present");
  }

  const hostRejection = hostHeaderValidationResponse(request, [
    ...dependencies.allowedHostnames,
  ]);
  if (hostRejection !== undefined) {
    return finish(plain(403, "Forbidden."), "host_rejected");
  }

  if (
    !bearerMatches(
      request.headers.get("authorization"),
      dependencies.tokenDigest,
    )
  ) {
    return finish(
      plain(401, "Unauthorized.", { "WWW-Authenticate": "Bearer" }),
      "unauthorized",
    );
  }

  let verdict: Awaited<ReturnType<typeof dependencies.budget.consume>>;
  try {
    verdict = await dependencies.budget.consume(
      PORTAL_MCP_SOURCE_ID,
      dependencies.clock(),
    );
  } catch (error) {
    // Sin poder contar no se sirve: el tope es parte del contrato (`TM-10`).
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "mcp budget unreadable",
      error instanceof Error ? error.name : typeof error,
    );
    return finish(plain(503, "MCP unavailable."), "budget_unreadable");
  }
  if (verdict.status === "daily_budget_exhausted") {
    return finish(
      plain(429, "Daily MCP budget exhausted.", {
        "Retry-After": String(
          Math.max(
            1,
            Math.ceil(
              (Date.parse(verdict.resumesAt) -
                Date.parse(dependencies.clock())) /
                1000,
            ),
          ),
        ),
      }),
      verdict.status,
    );
  }
  if (verdict.status !== "allowed") {
    return finish(plain(503, "MCP disabled."), verdict.status);
  }

  const readers = dependencies.readers(dependencies.health);
  const handler = createMcpHandler(
    () =>
      createOwnerMcpServer({
        readers,
        registry: dependencies.registry,
        requestId: dependencies.requestId,
        now: dependencies.now,
        log: dependencies.log,
      }),
    {
      legacy: "stateless",
      maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
      onerror: (error) => console.error("mcp transport error", error.name),
    },
  );

  try {
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return finish(
      new Response(response.body, { status: response.status, headers }),
      "served",
    );
  } finally {
    await handler.close();
  }
}
