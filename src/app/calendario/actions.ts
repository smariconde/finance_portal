"use server";

import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import {
  readMarketHoursCheck,
  type MarketHoursCheck,
} from "@/modules/trading/application/market-hours-service";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  refreshEarningsCalendar,
  refreshFredCalendar,
} from "@/server/jobs/market-calendar-refresh";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { safeErrorSummary } from "@/server/trading/safe-error";

export type MarketHoursResult =
  | MarketHoursCheck
  /** Sin Schwab configurado, o un runtime que no sirve datos. */
  | { readonly state: "unavailable" };

/**
 * Lo que dice Schwab del horario de hoy y de la próxima sesión, contra lo
 * declarado de la NYSE (`F12-01`, `session-corroboration-1.0.0`). No toma
 * entrada: qué fechas pedir lo decide el servidor (`TM-03`). Uno o dos `GET` a
 * `schwab-marketdata`; la respuesta se muestra y no se guarda.
 */
export async function checkMarketHours(): Promise<MarketHoursResult> {
  const health = await getRequestConfigHealth();
  if (!servesSchwabConnection(health)) return { state: "unavailable" };

  try {
    const { egress, now } = getLiveAccountDependencies();
    const result = await readMarketHoursCheck({ egress, now });
    if (result.state === "failed") {
      // El camino de claves es la medición del parser: nunca lleva valores.
      console.warn("schwab market hours read failed", result.code, result.path);
    }
    return result;
  } catch (error) {
    console.error("schwab market hours read failed", safeErrorSummary(error));
    return { state: "unavailable" };
  }
}

/** Every source and date is selected server-side. */
export async function refreshCalendarOnOpen(): Promise<boolean> {
  if (!servesRealData(await getRequestConfigHealth())) return false;
  try {
    const results = await Promise.allSettled([
      refreshEarningsCalendar(),
      refreshFredCalendar(),
    ]);
    return results.some(
      (result) => result.status === "fulfilled" && result.value,
    );
  } catch (error) {
    console.error("earnings calendar refresh failed", safeErrorSummary(error));
    return false;
  }
}
