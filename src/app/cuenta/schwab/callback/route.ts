import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import { completeSchwabConnection } from "@/modules/trading/application/schwab-connection-service";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getSchwabRuntime } from "@/server/trading/schwab-connection";

import {
  SCHWAB_STATE_COOKIE,
  SCHWAB_STATE_COOKIE_OPTIONS,
} from "../../schwab-cookie";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Vuelta de Schwab con el código de autorización (`F11-03`, ADR 0076,
 * sección 6). Nunca devuelve el input: redirige a `/cuenta` con un código de
 * resultado de un conjunto cerrado y, si algo falló sin código, con la
 * referencia del log. El 303 lleva a `/cuenta` sin el código, así que ninguna
 * página posterior lo ve, tampoco en el `Referer`.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const jar = await cookies();
  const cookieState = jar.get(SCHWAB_STATE_COOKIE)?.value ?? null;
  // El `state` sirve una sola vez, salga como salga.
  jar.set(SCHWAB_STATE_COOKIE, "", {
    ...SCHWAB_STATE_COOKIE_OPTIONS,
    maxAge: 0,
  });

  const destination = new URL("/cuenta", request.url);
  const back = (outcome: string, reference?: string) => {
    destination.searchParams.set("schwab", outcome);
    if (reference !== undefined) destination.searchParams.set("ref", reference);
    return new Response(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        Location: destination.toString(),
        "X-Request-Id": requestId,
      },
    });
  };

  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return back("unavailable");

  const query = new URL(request.url).searchParams;

  try {
    const runtime = getSchwabRuntime();
    const outcome = await completeSchwabConnection(
      runtime.dependencies,
      { callbackUrl: runtime.callbackUrl },
      {
        code: query.get("code"),
        error: query.get("error"),
        state: query.get("state"),
        cookieState,
        requestId,
      },
    );
    console.info("schwab callback", requestId, outcome);
    return back(outcome, outcome === "connected" ? undefined : requestId);
  } catch (error) {
    // Ni el código ni el `state` ni el mensaje: sólo el tipo (`TM-02`).
    console.error(
      "schwab callback failed",
      requestId,
      error instanceof Error ? error.name : typeof error,
    );
    return back("error", requestId);
  }
}
