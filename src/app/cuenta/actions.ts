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
import {
  syncSchwabTransactions,
  transactionsDue,
} from "@/modules/trading/application/transaction-sync-service";
import type { PositionContext } from "@/modules/trading/domain/position-context";
import { verifyQuoteScope } from "@/modules/trading/domain/quote-scope";
import {
  riskSettingsFormSchema,
  TRADING_RULES_VERSION,
  type RiskSettings,
} from "@/modules/trading/domain/trading-rules";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { reconcilePreMarketTrades } from "@/server/trading/pre-market";
import { getTradingRiskSettingsStore } from "@/server/persistence/trading/get-trading-risk-settings-store";
import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import { readEarningsCalendar } from "@/server/persistence/read-earnings-calendar";
import { loadPositionContext } from "@/server/trading/position-context";
import {
  readRiskContext,
  settingsOf,
  type RiskContext,
} from "@/server/trading/risk";
import { withTradingDeadline } from "@/server/trading/deadline";
import { safeErrorSummary } from "@/server/trading/safe-error";
import { getSchwabRuntime } from "@/server/trading/schwab-connection";
import { getTransactionSyncDependencies } from "@/server/trading/transactions";

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
    const reading = await withTradingDeadline("readLiveAccount", () =>
      readLiveAccountNow(getLiveAccountDependencies()),
    );
    if (reading.state === "failed") {
      console.warn(
        "schwab account read failed",
        reading.code,
        reading.path ?? "",
      );
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
    const reading = await withTradingDeadline("readLiveQuotes", () =>
      readLiveQuotesNow(getLiveAccountDependencies(), request.data.scope),
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
      readonly earnings: EarningsCalendarView | null;
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
 * Cruza las posiciones del alcance con su última valuación y sus earnings
 * (`position-context-2.0.0`). Lee sólo la base de análisis, nunca Schwab, y la
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
    const [contexts, earnings] = await Promise.race([
      Promise.all([
        loadPositionContext(symbols),
        readEarningsCalendar(now, { symbols }).catch(() => null),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PositionContextTimeoutError()),
          POSITION_CONTEXT_TIMEOUT_MS,
        );
      }),
    ]);
    return { state: "read", asOf: now, contexts, earnings };
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

/**
 * Un booleano y nada más (`TM-03`): `force` pide las transacciones aunque no
 * haya pasado la cadencia, porque la cuenta cambió de posiciones. Qué pedir lo
 * decide el servidor.
 */
const riskContextRequestSchema = z.object({ force: z.boolean() }).strict();

export type RiskContextResult =
  | (RiskContext & {
      readonly state: "read";
      /** El código de la sincronización que falló; lo guardado se lee igual. */
      readonly syncFailed: string | null;
    })
  | { readonly state: "failed"; readonly reference: string }
  | { readonly state: "unavailable" };

/**
 * Lo que el riesgo de la cuenta lee de la base de trading (`F11-09`): reglas,
 * plan de cada trade abierto y actividad de la sesión. Antes pone al día las
 * transacciones si pasó la cadencia de la cuenta (dos `GET` en el caso común,
 * `schwab-transactions-freshness-1.0.0`) o si las posiciones cambiaron. La
 * respuesta son niveles, conteos y códigos: nunca transacciones ni la cuenta.
 */
export async function readAccountRisk(
  input: unknown,
): Promise<RiskContextResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = riskContextRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  let syncFailed: string | null = null;
  try {
    await withTradingDeadline("readAccountRisk.sync", async () => {
      const dependencies = getTransactionSyncDependencies();
      if (
        request.data.force ||
        (await transactionsDue(dependencies.store, dependencies.now()))
      ) {
        const result = await syncSchwabTransactions(dependencies);
        if (result.state === "synced") await reconcilePreMarketTrades();
        if (result.state === "failed" || result.state === "quarantined") {
          console.warn("schwab transactions sync", result.state, result.code);
          syncFailed = result.code;
        }
      }
    });
  } catch (error) {
    console.error("schwab transactions sync failed", safeErrorSummary(error));
    syncFailed = "unavailable";
  }

  try {
    const context = await withTradingDeadline("readAccountRisk.read", () =>
      readRiskContext(new Date().toISOString()),
    );
    return { state: "read", ...context, syncFailed };
  } catch (error) {
    const reference = randomUUID();
    console.error(
      "account risk read failed",
      reference,
      safeErrorSummary(error),
    );
    return { state: "failed", reference };
  }
}

const riskSettingsRequestSchema = z
  .object({
    baseRevision: z.number().int().min(1).max(1_000_000).nullable(),
    fields: z
      .object({
        swingAllocationPercent: z.string(),
        riskPerTradePercent: z.string(),
        openRiskPercent: z.string(),
        dayRiskPerTradePercent: z.string(),
        dailyLossPercent: z.string(),
        maxTradesPerSession: z.string(),
        maxConsecutiveLosses: z.string(),
      })
      .strict(),
  })
  .strict();

export type SaveRiskSettingsResult =
  | {
      readonly state: "saved" | "unchanged";
      readonly revision: number;
      readonly settings: RiskSettings;
    }
  /** Otra pestaña guardó antes: lo vigente, para recargar el formulario. */
  | {
      readonly state: "conflict";
      readonly revision: number | null;
      readonly settings: RiskSettings;
    }
  /** El primer campo que no pasa y por qué; nunca el valor. */
  | { readonly state: "invalid"; readonly field: string; readonly code: string }
  | { readonly state: "unavailable" };

/**
 * Guarda las reglas propias (`trading-rules-2.0.0`) como revisión nueva contra
 * la que el owner editaba. Sólo escribe en la base de trading.
 */
export async function saveRiskSettings(
  input: unknown,
): Promise<SaveRiskSettingsResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };
  const request = riskSettingsRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };
  const settings = riskSettingsFormSchema.safeParse(request.data.fields);
  if (!settings.success) {
    const issue = settings.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    return {
      state: "invalid",
      field: /^[a-zA-Z]{0,40}$/u.test(field) ? field : "",
      code: /^[a-z_]{0,40}$/u.test(issue?.message ?? "")
        ? issue!.message
        : "invalid",
    };
  }

  try {
    const result = await getTradingRiskSettingsStore().save({
      baseRevision: request.data.baseRevision,
      settings: settings.data,
      version: TRADING_RULES_VERSION,
      recordedAt: new Date().toISOString(),
    });
    if (result.state === "conflict") {
      return {
        state: "conflict",
        revision: result.current?.revision ?? null,
        settings: settingsOf(result.current),
      };
    }
    return {
      state: result.state,
      revision: result.settings.revision,
      settings: settingsOf(result.settings),
    };
  } catch (error) {
    console.error("risk settings save failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}
