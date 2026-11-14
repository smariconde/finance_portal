import "server-only";

import {
  getConfigHealth,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import type { LiveAccountDependencies } from "@/modules/trading/application/live-account-service";
import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";
import { getTradingEgressFetch } from "@/server/egress/get-trading-egress-fetch";

import { SchwabUnavailableError } from "./schwab-connection";

/**
 * Raíz de composición de la cuenta en vivo (`F11-04`, ADR 0076). La puerta medida
 * con la cuota de la base de trading y la subclave que firma el alcance de las
 * cotizaciones. Nada de la base de análisis: la cuenta funciona sin ella.
 */
export function getLiveAccountDependencies(): LiveAccountDependencies {
  const health = getConfigHealth(process.env);
  if (!servesSchwabConnection(health)) throw new SchwabUnavailableError();

  const key = parseTradingSecretKey(process.env.TRADING_SECRET_KEY);
  if (!key.ok) throw new SchwabUnavailableError();

  return {
    egress: getTradingEgressFetch(),
    quoteScopeKey: deriveTradingSubkey(key.key, "quote-scope"),
    now: () => new Date().toISOString(),
  };
}
