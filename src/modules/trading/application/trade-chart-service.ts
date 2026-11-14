import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import {
  parseSchwabPriceHistory,
  SCHWAB_PRICE_HISTORY_PARSER_VERSION,
  type Candle,
} from "@/modules/trading/domain/schwab-price-history";
import {
  dailyChartPlan,
  placeFills,
  planTradeChart,
  TRADE_CHART_VERSION,
  type ChartFallbackReason,
  type ChartResolution,
  type FillMarker,
  type TradeChartPlan,
} from "@/modules/trading/domain/trade-chart";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";

import { liveFailureCode } from "./live-account-service";

const PRICE_HISTORY = "https://api.schwabapi.com/marketdata/v1/pricehistory";

/** Acciones y ETFs como los nombra Schwab (`BRK.B`, `BF/B`); nada más se pide. */
const CHARTABLE_SYMBOL = /^[A-Z][A-Z0-9./-]{0,15}$/u;

export type TradeChartDependencies = {
  readonly egress: EgressFetch;
  readonly now: () => string;
};

export type TradeChartReading =
  | {
      readonly state: "read";
      /** La hora en que Schwab respondió: las velas no se guardan. */
      readonly readAt: string;
      readonly resolution: ChartResolution;
      readonly extendedHours: boolean;
      readonly fallback: ChartFallbackReason | null;
      readonly candles: readonly Candle[];
      readonly markers: readonly FillMarker[];
      readonly requests: number;
      readonly versions: {
        readonly chart: typeof TRADE_CHART_VERSION;
        readonly parser: typeof SCHWAB_PRICE_HISTORY_PARSER_VERSION;
      };
    }
  | { readonly state: "failed"; readonly code: string };

type Fetched =
  | {
      readonly ok: true;
      readonly candles: readonly Candle[];
      readonly at: string;
    }
  | { readonly ok: false; readonly code: string };

async function fetchCandles(
  dependencies: TradeChartDependencies,
  symbol: string,
  plan: TradeChartPlan,
): Promise<Fetched> {
  const query = new URLSearchParams({ symbol, ...plan.params });
  const response: EgressFetchResponse = await dependencies.egress({
    sourceId: "schwab-marketdata",
    url: `${PRICE_HISTORY}?${query.toString()}`,
    accept: "application/json",
  });
  if (response.status !== 200) {
    return { ok: false, code: `http_${response.status}` };
  }
  const parsed = parseSchwabPriceHistory(response.body, {
    symbol,
    from: plan.from,
    to: plan.to,
  });
  if (!parsed.ok) return { ok: false, code: parsed.code };
  return { ok: true, candles: parsed.value.candles, at: response.fetchedAt };
}

/**
 * Las velas de un trade, pedidas al abrirlo y nunca guardadas (`F11-07`, ADR
 * 0076 sección 10). Un pedido a `schwab-marketdata`; dos si las velas de
 * minutos de la sesión vinieron vacías y se cae a las diarias, con el motivo.
 */
export async function readTradeChart(
  dependencies: TradeChartDependencies,
  trade: RoundTrip,
): Promise<TradeChartReading> {
  if (!CHARTABLE_SYMBOL.test(trade.symbol)) {
    return { state: "failed", code: "symbol_not_chartable" };
  }
  try {
    let plan = planTradeChart(trade, dependencies.now());
    let fetched = await fetchCandles(dependencies, trade.symbol, plan);
    let requests = 1;
    if (
      fetched.ok &&
      fetched.candles.length === 0 &&
      plan.resolution.kind === "minute"
    ) {
      plan = dailyChartPlan(trade, dependencies.now(), "intraday_empty");
      fetched = await fetchCandles(dependencies, trade.symbol, plan);
      requests += 1;
    }
    if (!fetched.ok) return { state: "failed", code: fetched.code };

    return {
      state: "read",
      readAt: fetched.at,
      resolution: plan.resolution,
      extendedHours: plan.extendedHours,
      fallback: plan.fallback,
      candles: fetched.candles,
      markers: placeFills(fetched.candles, trade.portions, plan.resolution),
      requests,
      versions: {
        chart: TRADE_CHART_VERSION,
        parser: SCHWAB_PRICE_HISTORY_PARSER_VERSION,
      },
    };
  } catch (error) {
    return { state: "failed", code: liveFailureCode(error) };
  }
}
