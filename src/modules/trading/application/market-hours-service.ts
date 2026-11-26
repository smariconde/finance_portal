import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  marketMomentAt,
  MARKET_SESSIONS_VERSION,
  type MarketDay,
} from "@/modules/market-calendar/domain/market-sessions";
import {
  corroborateSession,
  SESSION_CORROBORATION_VERSION,
  type SessionCorroboration,
} from "@/modules/market-calendar/domain/session-corroboration";
import {
  parseSchwabMarketHours,
  SCHWAB_MARKET_HOURS_PARSER_VERSION,
} from "@/modules/trading/domain/schwab-market-hours";

import { liveFailureCode } from "./live-account-service";

const MARKET_HOURS = "https://api.schwabapi.com/marketdata/v1/markets";

export type MarketHoursDependencies = {
  readonly egress: EgressFetch;
  readonly now: () => string;
};

export type MarketHoursCheck =
  | {
      readonly state: "read";
      /** La hora en que Schwab respondió: la respuesta no se guarda. */
      readonly readAt: string;
      /** Hoy en Nueva York y la próxima sesión declarada, en ese orden. */
      readonly days: readonly SessionCorroboration[];
      readonly requests: number;
      readonly versions: {
        readonly sessions: typeof MARKET_SESSIONS_VERSION;
        readonly corroboration: typeof SESSION_CORROBORATION_VERSION;
        readonly parser: typeof SCHWAB_MARKET_HOURS_PARSER_VERSION;
      };
    }
  | {
      readonly state: "failed";
      readonly code: string;
      /** Camino de claves donde el parser se negó, sin valores. */
      readonly path: string | null;
    };

/**
 * Lo declarado de la NYSE contra lo que dice Schwab para hoy y la próxima
 * sesión (`F12-01`, ADR 0088 decisión 2). Un `GET` a `schwab-marketdata` por
 * fecha, a lo sumo dos; nada se guarda.
 */
export async function readMarketHoursCheck(
  dependencies: MarketHoursDependencies,
): Promise<MarketHoursCheck> {
  const moment = marketMomentAt(dependencies.now());
  const dates: MarketDay[] = [moment.today];
  if (moment.nextOpen !== null && moment.nextOpen.date !== moment.today.date) {
    dates.push(moment.nextOpen);
  }

  try {
    const days: SessionCorroboration[] = [];
    let readAt = "";
    for (const declared of dates) {
      const query = new URLSearchParams({
        markets: "equity",
        date: declared.date,
      });
      const response = await dependencies.egress({
        sourceId: "schwab-marketdata",
        url: `${MARKET_HOURS}?${query.toString()}`,
        accept: "application/json",
      });
      if (response.status !== 200) {
        return { state: "failed", code: `http_${response.status}`, path: null };
      }
      const parsed = parseSchwabMarketHours(response.body, declared.date);
      if (!parsed.ok) {
        return { state: "failed", code: parsed.code, path: parsed.path };
      }
      days.push(corroborateSession(declared, parsed.value));
      readAt = response.fetchedAt;
    }

    return {
      state: "read",
      readAt,
      days,
      requests: dates.length,
      versions: {
        sessions: MARKET_SESSIONS_VERSION,
        corroboration: SESSION_CORROBORATION_VERSION,
        parser: SCHWAB_MARKET_HOURS_PARSER_VERSION,
      },
    };
  } catch (error) {
    return { state: "failed", code: liveFailureCode(error), path: null };
  }
}
