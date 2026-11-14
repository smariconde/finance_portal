"use server";

import { randomUUID } from "node:crypto";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { servesSchwabConnection } from "@/modules/configuration/domain/config-health";
import {
  readLiveAccount as readLiveAccountNow,
  readLiveQuotes as readLiveQuotesNow,
  type LiveAccountReading,
  type LiveQuotesReading,
} from "@/modules/trading/application/live-account-service";
import { startSchwabConnection } from "@/modules/trading/application/schwab-connection-service";
import type { PositionContext } from "@/modules/trading/domain/position-context";
import { verifyQuoteScope } from "@/modules/trading/domain/quote-scope";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { loadPositionContext } from "@/server/trading/position-context";
import { safeErrorSummary } from "@/server/trading/safe-error";
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
    // Tipo y código del driver; el mensaje puede traer un host o SQL (`TM-02`).
    console.error("schwab connect failed", reference, safeErrorSummary(error));
    return { state: "failed", reference };
  }

  // Fuera del try: `redirect` corta la acción lanzando, y no es una falla. La
  // URL es externa (api.schwabapi.com), que las rutas tipadas no conocen; la
  // arma el dominio con host y path fijos.
  redirect(authorizeUrl as Route);
}

const liveAccountRequestSchema = z.object({}).strict();
/** El alcance firmado que emitió la última lectura; nunca un ticker suelto. */
const scopedRequestSchema = z
  .object({ scope: z.string().min(1).max(4096) })
  .strict();

export type LiveAccountResult =
  | LiveAccountReading
  /** Runtime trabado, falta configuración o el input no es el esperado. */
  | { readonly state: "unavailable" };

/**
 * Lee la cuenta al momento (`F11-04`, ADR 0076, sección 8): posiciones, saldos,
 * poder de compra y órdenes abiertas. La página la llama cada 60 s en sesión y
 * cada 5 minutos fuera, sólo visible (`schwab-live-cadence-1.0.0`).
 *
 * Tratada como endpoint público (`TM-03`): modo resuelto en el request, input
 * vacío y cerrado, cuatro `GET` por la puerta medida (`TM-10`) y una respuesta
 * sin número de cuenta, `hashValue` ni cuerpos; una falla es un código. Nada se
 * cachea (`TM-04`).
 */
export async function readLiveAccount(
  input: unknown,
): Promise<LiveAccountResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  if (!liveAccountRequestSchema.safeParse(input).success) {
    return { state: "unavailable" };
  }

  try {
    const reading = await readLiveAccountNow(getLiveAccountDependencies());
    if (reading.state === "failed") {
      console.warn("schwab account read failed", reading.code);
    }
    return reading;
  } catch (error) {
    console.error("schwab account read failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

export type LiveQuotesResult =
  LiveQuotesReading | { readonly state: "unavailable" };

/**
 * Cotiza las posiciones abiertas de la última lectura (`schwab-quote-scope-1.0.0`):
 * cada 15 s en sesión y sólo con la página visible. Un alcance vencido o ajeno
 * no sale a Schwab.
 */
export async function readLiveQuotes(
  input: unknown,
): Promise<LiveQuotesResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = scopedRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  try {
    const reading = await readLiveQuotesNow(
      getLiveAccountDependencies(),
      request.data.scope,
    );
    if (reading.state === "failed") {
      console.warn("schwab quotes read failed", reading.code);
    }
    return reading;
  } catch (error) {
    console.error("schwab quotes read failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

export type PositionContextResult =
  | {
      readonly state: "read";
      readonly asOf: string;
      readonly contexts: readonly PositionContext[];
    }
  /** La base de análisis no respondió a tiempo; la cuenta sigue igual. */
  | { readonly state: "analysis_unavailable"; readonly reference: string }
  | { readonly state: "unavailable" };

/** El cruce no espera más que esto: la cuenta ya está en pantalla. */
const POSITION_CONTEXT_TIMEOUT_MS = 8_000;

class PositionContextTimeoutError extends Error {
  override readonly name = "PositionContextTimeoutError";
}

/**
 * Cruza las posiciones del alcance con valuación, sector y CEDEAR
 * (`position-context-1.0.0`). Lee sólo la base de análisis, nunca Schwab, y la
 * página lo pide una vez por conjunto de símbolos.
 */
export async function readPositionContext(
  input: unknown,
): Promise<PositionContextResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = scopedRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  const now = new Date().toISOString();
  let symbols: readonly string[];
  try {
    const check = verifyQuoteScope(
      getLiveAccountDependencies().quoteScopeKey,
      request.data.scope,
      now,
    );
    if (!check.ok) return { state: "unavailable" };
    symbols = check.scope.symbols;
  } catch (error) {
    console.error("position context failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const contexts = await Promise.race([
      loadPositionContext(symbols, now),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PositionContextTimeoutError()),
          POSITION_CONTEXT_TIMEOUT_MS,
        );
      }),
    ]);
    return { state: "read", asOf: now, contexts };
  } catch (error) {
    const reference = randomUUID();
    console.error(
      "position context failed",
      reference,
      safeErrorSummary(error),
    );
    return { state: "analysis_unavailable", reference };
  } finally {
    clearTimeout(timer);
  }
}
