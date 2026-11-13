"use server";

import { randomUUID } from "node:crypto";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import { startSchwabConnection } from "@/modules/trading/application/schwab-connection-service";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getSchwabRuntime } from "@/server/trading/schwab-connection";

import {
  SCHWAB_STATE_COOKIE,
  SCHWAB_STATE_COOKIE_OPTIONS,
} from "./schwab-cookie";

/** Sin input: nada del cliente decide a dónde se va ni con qué (`TM-03`). */
const connectRequestSchema = z.object({}).strict();

export type ConnectSchwabResult =
  /** Runtime trabado, falta configuración o el input no es el esperado. */
  | { readonly state: "unavailable" }
  /** Las filas de derechos de Schwab no están aprobadas (`TM-15`). */
  | { readonly state: "rights_blocked" }
  /** La base de trading no respondió; la referencia busca el log. */
  | { readonly state: "failed"; readonly reference: string };

/**
 * Empieza la conexión con Schwab (`F11-03`, ADR 0076). Emite un `state` de un
 * solo uso, lo deja en la cookie y redirige a la autorización de Schwab. Si
 * redirige, no devuelve: lo que sí devuelve son códigos, nunca la URL, la app
 * key ni el `state`.
 *
 * Next.js ya rechaza una acción cuyo `Origin` no coincide con el host.
 */
export async function connectSchwab(
  input: unknown,
): Promise<ConnectSchwabResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  if (!connectRequestSchema.safeParse(input).success) {
    return { state: "unavailable" };
  }

  let authorizeUrl: string;
  try {
    const runtime = getSchwabRuntime();
    const start = await startSchwabConnection(runtime.dependencies, {
      appKey: runtime.appKey,
      callbackUrl: runtime.callbackUrl,
    });
    if (start.outcome === "rights_blocked") return { state: "rights_blocked" };

    (await cookies()).set(
      SCHWAB_STATE_COOKIE,
      start.state,
      SCHWAB_STATE_COOKIE_OPTIONS,
    );
    authorizeUrl = start.authorizeUrl;
  } catch (error) {
    const reference = randomUUID();
    // Sólo el tipo: el mensaje puede traer un host o SQL (`TM-02`).
    console.error(
      "schwab connect failed",
      reference,
      error instanceof Error ? error.name : typeof error,
    );
    return { state: "failed", reference };
  }

  // Fuera del try: `redirect` corta la acción lanzando, y no es una falla. La
  // URL es externa (api.schwabapi.com), que las rutas tipadas no conocen; la
  // arma el dominio con host y path fijos.
  redirect(authorizeUrl as Route);
}
