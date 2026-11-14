import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import type { Candle } from "./schwab-price-history";
import type { FillPortion, RoundTrip } from "./trade-round-trips";
import { tradingSessionOf } from "./trading-session";

/**
 * Qué velas dibuja el gráfico de un trade (`trade-chart-1.0.0`, `F11-07`).
 *
 * - **Day trade** (o un trade abierto hoy): las velas de minutos de su sesión, en
 *   horario regular, o extendido si alguna ejecución cayó fuera de él. De 1
 *   minuto hasta 40 días atrás y de 5 hasta 240: Schwab sirvió 47 días y unos
 *   8,5 meses el 2026-11-14, y el margen evita pedir algo que ya no está.
 * - **Más atrás, o un swing:** velas diarias desde 120 días antes de la entrada
 *   hasta 30 después de la salida (u hoy). Un day trade viejo se dibuja así y
 *   la razón se nombra (`intraday_beyond_depth`); nunca se inventa una vela.
 * - **Ejecuciones:** cada una cae en la vela que contiene su hora (en una
 *   diaria, la de su sesión). Si su precio queda fuera del rango de la vela, se
 *   cuenta: suele ser un split que Schwab ya ajustó en las velas y no en las
 *   ejecuciones, y el gráfico lo dice en vez de esconderlo.
 */
export const TRADE_CHART_VERSION = "trade-chart-1.0.0";

export const MINUTE_1_DEPTH_DAYS = 40;
export const MINUTE_5_DEPTH_DAYS = 240;
const DAILY_BEFORE_DAYS = 120;
const DAILY_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export type ChartResolution =
  | { readonly kind: "minute"; readonly minutes: 1 | 5 }
  | { readonly kind: "daily" };

export type ChartFallbackReason = "intraday_beyond_depth" | "intraday_empty";

export type TradeChartPlan = {
  readonly resolution: ChartResolution;
  readonly extendedHours: boolean;
  /** Ventana en epoch de milisegundos, inclusive. */
  readonly from: number;
  readonly to: number;
  /** Por qué no son velas de minutos, si correspondían. */
  readonly fallback: ChartFallbackReason | null;
  /** Parámetros de `pricehistory`, sin el símbolo. */
  readonly params: Readonly<Record<string, string>>;
};

type ChartTrade = Pick<
  RoundTrip,
  | "status"
  | "dayTrade"
  | "openedAt"
  | "openedSession"
  | "closedSession"
  | "portions"
>;

const NEW_YORK_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const CHICAGO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El reloj de Nueva York de un instante, como si fuera UTC. */
function newYorkWallClock(epoch: number): number {
  const parts = Object.fromEntries(
    NEW_YORK_PARTS.formatToParts(new Date(epoch)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** El instante de una hora de Nueva York en una sesión: `2026-04-29`, `09:30`. */
export function newYorkInstant(session: string, time: string): number {
  const naive = Date.parse(`${session}T${time}:00.000Z`);
  let guess = naive + (naive - newYorkWallClock(naive));
  // Un segundo paso corrige la sesión en que cambia el horario de verano.
  guess += naive - newYorkWallClock(guess);
  return guess;
}

/** Minutos desde la medianoche de Nueva York. */
function newYorkMinutes(instant: string): number {
  const wall = newYorkWallClock(Date.parse(instant));
  return Math.floor((wall % DAY_MS) / 60_000);
}

const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;

function outsideRegularHours(portions: readonly FillPortion[]): boolean {
  return portions.some((portion) => {
    const minutes = newYorkMinutes(portion.executedAt);
    return minutes < REGULAR_OPEN || minutes >= REGULAR_CLOSE;
  });
}

const addDays = (session: string, days: number) =>
  new Date(Date.parse(`${session}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** Velas diarias alrededor del trade, nunca después de `now`. */
export function dailyChartPlan(
  trade: ChartTrade,
  now: string,
  fallback: ChartFallbackReason | null,
): TradeChartPlan {
  const today = tradingSessionOf(now);
  const first = tradingSessionOf(
    trade.portions[0]?.executedAt ?? trade.openedAt,
  );
  const last = trade.closedSession ?? today;
  const from = Date.parse(
    `${addDays(first, -DAILY_BEFORE_DAYS)}T00:00:00.000Z`,
  );
  const to = Math.min(
    Date.parse(now),
    Date.parse(`${addDays(last, DAILY_AFTER_DAYS)}T23:59:59.999Z`),
  );
  return {
    resolution: { kind: "daily" },
    extendedHours: false,
    from,
    to,
    fallback,
    params: {
      periodType: "year",
      frequencyType: "daily",
      frequency: "1",
      startDate: String(from),
      endDate: String(to),
      needExtendedHoursData: "false",
    },
  };
}

export function planTradeChart(trade: ChartTrade, now: string): TradeChartPlan {
  const today = tradingSessionOf(now);
  const intraday =
    (trade.status === "closed" && trade.dayTrade) ||
    (trade.status === "open" && trade.openedSession === today);
  if (!intraday) return dailyChartPlan(trade, now, null);

  const session = trade.openedSession;
  const age = (Date.parse(today) - Date.parse(session)) / DAY_MS;
  const minutes =
    age <= MINUTE_1_DEPTH_DAYS ? 1 : age <= MINUTE_5_DEPTH_DAYS ? 5 : null;
  if (minutes === null) {
    return dailyChartPlan(trade, now, "intraday_beyond_depth");
  }

  const extendedHours = outsideRegularHours(trade.portions);
  const from = newYorkInstant(session, extendedHours ? "04:00" : "09:30");
  const to = Math.min(
    Date.parse(now),
    newYorkInstant(session, extendedHours ? "20:00" : "16:00") - 1,
  );
  return {
    resolution: { kind: "minute", minutes },
    extendedHours,
    from,
    to,
    fallback: null,
    params: {
      periodType: "day",
      frequencyType: "minute",
      frequency: String(minutes),
      startDate: String(from),
      endDate: String(to),
      needExtendedHoursData: String(extendedHours),
    },
  };
}

export type FillMarker = {
  readonly fillId: string;
  readonly side: "buy" | "sell";
  readonly role: "open" | "close";
  readonly price: string;
  readonly quantity: string;
  readonly executedAt: string;
  /** La vela que la contiene; `null` si la ventana no la trae. */
  readonly candleIndex: number | null;
  /** Su precio fuera del mínimo y el máximo de esa vela. */
  readonly outsideCandle: boolean;
};

const { parseDecimal } = createDecimalOperations((code) => new Error(code));

/** Ubica cada ejecución en su vela y marca las que no caben en su rango. */
export function placeFills(
  candles: readonly Candle[],
  portions: readonly FillPortion[],
  resolution: ChartResolution,
): FillMarker[] {
  const sessions =
    resolution.kind === "daily"
      ? candles.map((candle) => CHICAGO_DATE.format(new Date(candle.time)))
      : null;
  const width =
    resolution.kind === "minute" ? resolution.minutes * 60_000 : null;

  return portions.map((portion) => {
    const at = Date.parse(portion.executedAt);
    let index: number;
    if (sessions !== null) {
      index = sessions.indexOf(tradingSessionOf(portion.executedAt));
    } else {
      index = candles.findIndex(
        (candle) => candle.time <= at && at < candle.time + width!,
      );
    }
    const candle = index < 0 ? null : candles[index]!;
    const price = parseDecimal(portion.price, "trade-chart");
    return {
      fillId: portion.fillId,
      side: portion.side,
      role: portion.role,
      price: portion.price,
      quantity: portion.quantity,
      executedAt: portion.executedAt,
      candleIndex: candle === null ? null : index,
      outsideCandle:
        candle !== null &&
        (price.lessThan(parseDecimal(candle.low, "trade-chart")) ||
          price.greaterThan(parseDecimal(candle.high, "trade-chart"))),
    };
  });
}
