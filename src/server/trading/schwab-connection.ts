import "server-only";

import {
  getConfigHealth,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  provideSchwabAccessToken,
  type SchwabConnectionDependencies,
} from "@/modules/trading/application/schwab-connection-service";
import { SCHWAB_TOKEN_URL } from "@/modules/trading/domain/schwab-oauth";
import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";
import { getTradingEgressFetch } from "@/server/egress/get-trading-egress-fetch";
import { getSchwabConnectionStore } from "@/server/persistence/trading/get-schwab-connection-store";

/**
 * Raíz de composición de la conexión con Schwab (ADR 0076). Lee las variables
 * en el request, nunca en el build, y no devuelve nunca la clave, la app key ni
 * un token a quien la llama: la Server Action y el callback reciben sólo la URL
 * de autorización y códigos de resultado.
 */
export class SchwabUnavailableError extends Error {
  constructor() {
    super("The Schwab connection is not configured on this runtime.");
    this.name = "SchwabUnavailableError";
  }
}

/**
 * Códigos del gate de derechos para hablar con Schwab. Se evalúa la fuente del
 * token, que es la que sale primero; el registro declarado en código es la
 * autoridad (`TM-15`).
 */
export function schwabRightsBlockedBy(): readonly string[] {
  const entry = DEMO_SOURCE_REGISTRY.find(
    (candidate) => candidate.sourceId === "schwab-oauth",
  );
  if (!entry) return ["source_not_registered"];
  return evaluateIngestionRights(entry, {
    storesRawPayload: false,
    storesNormalizedValues: false,
    publicDisplay: false,
  }).blockedBy;
}

export type SchwabRuntime = {
  readonly dependencies: SchwabConnectionDependencies;
  readonly appKey: string;
  readonly callbackUrl: string;
};

/** Sólo en `personal` con la base de trading y las cuatro variables válidas. */
export function getSchwabRuntime(): SchwabRuntime {
  const health = getConfigHealth(process.env);
  if (!servesSchwabConnection(health)) throw new SchwabUnavailableError();

  const key = parseTradingSecretKey(process.env.TRADING_SECRET_KEY);
  if (!key.ok) throw new SchwabUnavailableError();

  const egress = getTradingEgressFetch();

  return {
    appKey: process.env.SCHWAB_APP_KEY!.trim(),
    callbackUrl: process.env.SCHWAB_CALLBACK_URL!.trim(),
    dependencies: {
      store: getSchwabConnectionStore(),
      tokenKey: deriveTradingSubkey(key.key, "schwab-token-encryption"),
      rightsBlockedBy: schwabRightsBlockedBy,
      now: () => new Date().toISOString(),
      requestToken: async (form) => {
        const response = await egress({
          sourceId: "schwab-oauth",
          url: SCHWAB_TOKEN_URL,
          method: "POST",
          body: form,
          contentType: "application/x-www-form-urlencoded",
          accept: "application/json",
        });
        return { status: response.status, body: response.body };
      },
    },
  };
}

/**
 * El proveedor que usa la puerta para `schwab-trader` y `schwab-marketdata`.
 * Sin configuración o sin conexión devuelve `undefined`, y la puerta se niega
 * con `credential_missing` nombrando el proveedor.
 */
export async function provideSchwabAccessTokenForEgress(): Promise<
  string | undefined
> {
  let runtime: SchwabRuntime;
  try {
    runtime = getSchwabRuntime();
  } catch {
    return undefined;
  }
  return provideSchwabAccessToken(runtime.dependencies);
}
