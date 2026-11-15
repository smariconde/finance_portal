import {
  createDecimalOperations,
  sum,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { SessionExit } from "./daily-pnl";
import type { RMultiple, RMultipleReason } from "./trade-r-multiple";
import type { RoundTrip } from "./trade-round-trips";

/**
 * Estadísticas del diario y sus cortes (`trading-stats-1.0.0`, ADR 0076,
 * sección 9, `F11-08`).
 *
 * - **Muestra:** los trades cerrados. Uno abierto no tiene resultado y uno
 *   abierto antes de la historia no tiene entrada; se cuentan aparte
 *   (`excluded`), nunca como un cero.
 * - **Win rate:** ganadores sobre todos los cerrados. Un trade en cero no es un
 *   ganador y sí cuenta en el denominador.
 * - **Expectancy** en dinero: el P&L medio por trade, que es lo mismo que
 *   `win rate × ganancia media − loss rate × pérdida media`.
 * - **Expectancy en R:** el R medio de los trades que lo tienen, con cuántos son
 *   (`n`) y cuántos no (`missing`). A diferencia de un total del calendario, una
 *   media sobre la parte con stop planeado es una muestra legítima: los trades
 *   viejos nunca tendrán stop (no se puede rehacer) y exigirlo en todos dejaría
 *   R en `null` para siempre. Sin ninguno, `null` con el motivo del primero.
 * - **Profit factor:** ganancia bruta sobre pérdida bruta. Sin pérdidas es
 *   `null` con `no_losses`, nunca infinito; sin ganancias y con pérdidas es 0.
 * - **Drawdown** sobre la curva realizada: lo realizado por cada salida, en orden
 *   de ejecución (`trading-daily-pnl-1.0.0`), acumulado desde cero. Es la mayor
 *   caída desde un máximo previo, en dinero, con su máximo, su piso y la salida
 *   que lo recuperó. Una salida sin P&L conocido no mueve la curva.
 * - **Cortes:** setup (el vigente; sin setup es su propio grupo), hora y día de
 *   la semana **de la entrada** en Nueva York (la decisión se toma al entrar),
 *   ticker y day o swing. Un grupo con menos de `SMALL_SAMPLE` trades se marca.
 * - **Moneda:** todo en una. Trades en más de una dan `currency_mismatch`.
 */
export const TRADING_STATS_VERSION = "trading-stats-1.0.0";

/** Por debajo de esto un grupo se marca como muestra chica. */
export const SMALL_SAMPLE = 5;

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export type CutDimension = "setup" | "hour" | "weekday" | "ticker" | "holding";

export const CUT_DIMENSIONS: readonly CutDimension[] = [
  "setup",
  "hour",
  "weekday",
  "ticker",
  "holding",
];

/** Lo que las estadísticas leen de un trade y de su anotación. */
export type StatsTrade = Pick<
  RoundTrip,
  | "tradeId"
  | "symbol"
  | "currency"
  | "status"
  | "openedAt"
  | "openedSession"
  | "dayTrade"
  | "realizedPnl"
> & {
  readonly setupCode: string | null;
  readonly r: RMultiple;
};

export type ExpectancyR =
  | {
      readonly value: string;
      readonly reason: null;
      readonly n: number;
      readonly missing: number;
    }
  | {
      readonly value: null;
      readonly reason: RMultipleReason;
      readonly n: 0;
      readonly missing: number;
    };

export type ProfitFactor =
  | { readonly value: string; readonly reason: null }
  | { readonly value: null; readonly reason: "no_losses" };

export type TradeStats = {
  readonly trades: number;
  readonly winners: number;
  readonly losers: number;
  readonly breakeven: number;
  /** Fracción de 0 a 1. */
  readonly winRate: string;
  readonly realizedPnl: string;
  readonly grossProfit: string;
  /** Positiva: la magnitud de lo perdido. */
  readonly grossLoss: string;
  /** `null` sin ganadores. */
  readonly averageWin: string | null;
  /** Positiva; `null` sin perdedores. */
  readonly averageLoss: string | null;
  readonly expectancy: string;
  readonly expectancyR: ExpectancyR;
  readonly profitFactor: ProfitFactor;
  readonly smallSample: boolean;
};

export type CutGroup = {
  /** Código de setup, hora `09`, día ISO `1`–`7`, símbolo, `day` o `swing`. */
  readonly key: string | null;
  readonly stats: TradeStats;
};

export type CurvePoint = {
  readonly tradeId: string;
  readonly symbol: string;
  readonly executedAt: string;
  readonly session: string;
  readonly pnl: string;
  readonly cumulative: string;
  /** Lo que la curva está bajo su máximo previo: cero o negativo. */
  readonly drawdown: string;
};

export type MaxDrawdown = {
  /** Positiva; cero si la curva nunca cayó. */
  readonly amount: string;
  /** `null` si el máximo es el arranque de la historia, o si nunca cayó. */
  readonly peakAt: string | null;
  readonly peak: string;
  /** `null` si nunca cayó. */
  readonly troughAt: string | null;
  readonly trough: string;
  /** La salida que volvió al máximo; `null` si sigue abajo o nunca cayó. */
  readonly recoveredAt: string | null;
};

export type Drawdown = {
  readonly max: MaxDrawdown;
  /** Cero o negativo: dónde está hoy la curva contra su máximo. */
  readonly current: string;
  readonly curve: readonly CurvePoint[];
};

export type TradingStats =
  | {
      readonly state: "ready";
      readonly currency: string | null;
      readonly excluded: {
        readonly open: number;
        readonly beforeHistory: number;
      };
      /** `null` sin trades cerrados. */
      readonly overall: TradeStats | null;
      readonly cuts: Readonly<Record<CutDimension, readonly CutGroup[]>>;
      /** `null` sin salidas con P&L conocido. */
      readonly drawdown: Drawdown | null;
    }
  | {
      readonly state: "currency_mismatch";
      readonly currencies: readonly string[];
    };

const PATH = "trading-stats";

function mean(values: readonly Dec[]): Dec {
  return divide(sum(values), parseDecimal(String(values.length), PATH), PATH);
}

/** Las cifras de un grupo de trades cerrados; `null` si no hay ninguno. */
export function tradeStatsOf(trades: readonly StatsTrade[]): TradeStats | null {
  if (trades.length === 0) return null;
  const pnl = trades.map((trade) => {
    if (trade.realizedPnl === null) {
      throw new Error(`Trade ${trade.tradeId} has no realized P&L.`);
    }
    return parseDecimal(trade.realizedPnl, PATH);
  });
  const wins = pnl.filter((value) => value.greaterThan(ZERO));
  const losses = pnl.filter((value) => value.lessThan(ZERO));
  const grossProfit = sum(wins);
  const grossLoss = sum(losses).negated();
  const withR = trades.filter((trade) => trade.r.value !== null);
  const firstWithoutR = trades.find((trade) => trade.r.value === null);

  return {
    trades: trades.length,
    winners: wins.length,
    losers: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRate: formatDecimal(
      divide(
        parseDecimal(String(wins.length), PATH),
        parseDecimal(String(trades.length), PATH),
        PATH,
      ),
      PATH,
    ),
    realizedPnl: formatDecimal(sum(pnl), PATH),
    grossProfit: formatDecimal(grossProfit, PATH),
    grossLoss: formatDecimal(grossLoss, PATH),
    averageWin: wins.length === 0 ? null : formatDecimal(mean(wins), PATH),
    averageLoss:
      losses.length === 0 ? null : formatDecimal(mean(losses).negated(), PATH),
    expectancy: formatDecimal(mean(pnl), PATH),
    expectancyR:
      withR.length === 0
        ? {
            value: null,
            reason: firstWithoutR!.r.reason!,
            n: 0,
            missing: trades.length,
          }
        : {
            value: formatDecimal(
              mean(withR.map((trade) => parseDecimal(trade.r.value!, PATH))),
              PATH,
            ),
            reason: null,
            n: withR.length,
            missing: trades.length - withR.length,
          },
    profitFactor: grossLoss.isZero()
      ? { value: null, reason: "no_losses" }
      : {
          value: formatDecimal(divide(grossProfit, grossLoss, PATH), PATH),
          reason: null,
        },
    smallSample: trades.length < SMALL_SAMPLE,
  };
}

const NEW_YORK_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hourCycle: "h23",
});

/** La hora de reloj en Nueva York, `00`–`23`. */
export function newYorkHourOf(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error("An entry hour needs a valid instant.");
  }
  return NEW_YORK_HOUR.format(date).padStart(2, "0");
}

/** Día ISO de una sesión `YYYY-MM-DD`: `1` el lunes, `7` el domingo. */
export function isoWeekdayOf(session: string): string {
  const day = new Date(`${session}T00:00:00Z`).getUTCDay();
  return String(day === 0 ? 7 : day);
}

function keyOf(trade: StatsTrade, dimension: CutDimension): string | null {
  switch (dimension) {
    case "setup":
      return trade.setupCode;
    case "hour":
      return newYorkHourOf(trade.openedAt);
    case "weekday":
      return isoWeekdayOf(trade.openedSession);
    case "ticker":
      return trade.symbol;
    case "holding":
      return trade.dayTrade ? "day" : "swing";
  }
}

/** Hora, día y day o swing en su orden natural; setup y ticker, por tamaño. */
function compareGroups(dimension: CutDimension) {
  return (a: CutGroup, b: CutGroup): number => {
    if (
      dimension === "hour" ||
      dimension === "weekday" ||
      dimension === "holding"
    ) {
      return (a.key ?? "").localeCompare(b.key ?? "");
    }
    // Sin setup va al final: no es un setup.
    if (a.key === null || b.key === null) {
      return a.key === null ? (b.key === null ? 0 : 1) : -1;
    }
    return (
      b.stats.trades - a.stats.trades ||
      a.key.localeCompare(b.key, "en", { numeric: true })
    );
  };
}

export function cutBy(
  trades: readonly StatsTrade[],
  dimension: CutDimension,
): CutGroup[] {
  const groups = new Map<string | null, StatsTrade[]>();
  for (const trade of trades) {
    const key = keyOf(trade, dimension);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [trade]);
    else group.push(trade);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, stats: tradeStatsOf(group)! }))
    .sort(compareGroups(dimension));
}

/** La curva realizada salida por salida y su mayor caída. */
export function realizedDrawdown(
  exits: readonly SessionExit[],
): Drawdown | null {
  const known = exits.filter((exit) => exit.realizedPnl !== null);
  if (known.length === 0) return null;

  let cumulative = ZERO;
  let peak = ZERO;
  // `null`: el máximo es el arranque de la historia, en cero.
  let peakAt: string | null = null;
  let worst = ZERO;
  let max = null as MaxDrawdown | null;
  const curve: CurvePoint[] = [];

  for (const exit of known) {
    cumulative = cumulative.plus(parseDecimal(exit.realizedPnl!, PATH));
    if (cumulative.greaterThanOrEqualTo(peak)) {
      // Volver al máximo de la mayor caída la recupera; superarlo, también.
      if (max !== null && max.recoveredAt === null && max.peakAt === peakAt) {
        max = { ...max, recoveredAt: exit.executedAt };
      }
      peak = cumulative;
      peakAt = exit.executedAt;
    }
    const drawdown = cumulative.minus(peak);
    if (drawdown.lessThan(worst)) {
      worst = drawdown;
      max = {
        amount: formatDecimal(drawdown.negated(), PATH),
        peakAt,
        peak: formatDecimal(peak, PATH),
        troughAt: exit.executedAt,
        trough: formatDecimal(cumulative, PATH),
        recoveredAt: null,
      };
    }
    curve.push({
      tradeId: exit.tradeId,
      symbol: exit.symbol,
      executedAt: exit.executedAt,
      session: exit.session,
      pnl: exit.realizedPnl!,
      cumulative: formatDecimal(cumulative, PATH),
      drawdown: formatDecimal(drawdown, PATH),
    });
  }

  return {
    max: max ?? {
      amount: "0",
      peakAt: null,
      peak: formatDecimal(peak, PATH),
      troughAt: null,
      trough: formatDecimal(peak, PATH),
      recoveredAt: null,
    },
    current: formatDecimal(cumulative.minus(peak), PATH),
    curve,
  };
}

/** Las estadísticas de todo el diario y sus cortes. */
export function tradingStats(
  trades: readonly StatsTrade[],
  exits: readonly SessionExit[],
): TradingStats {
  const currencies = [...new Set(trades.map((trade) => trade.currency))].sort();
  if (currencies.length > 1) return { state: "currency_mismatch", currencies };

  const closed = trades.filter((trade) => trade.status === "closed");
  return {
    state: "ready",
    currency: currencies[0] ?? null,
    excluded: {
      open: trades.filter((trade) => trade.status === "open").length,
      beforeHistory: trades.filter(
        (trade) => trade.status === "opened_before_history",
      ).length,
    },
    overall: tradeStatsOf(closed),
    cuts: Object.fromEntries(
      CUT_DIMENSIONS.map((dimension) => [dimension, cutBy(closed, dimension)]),
    ) as Record<CutDimension, CutGroup[]>,
    drawdown: realizedDrawdown(exits),
  };
}
