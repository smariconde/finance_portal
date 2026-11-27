import type { EarningsReport } from "@/modules/market-calendar/domain/earnings-calendar";
import { nextReportFor } from "@/modules/market-calendar/domain/earnings-exposure";

import { z } from "zod";

import {
  createDecimalOperations,
  HUNDRED,
  sum,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { RoundTrip } from "./trade-round-trips";
import { bookOfTrade, type TradingBook } from "./trading-book";
import { tradingSessionOf } from "./trading-session";

/**
 * Las reglas propias del owner como alertas (ADR 0076, sección 9; `F11-09`,
 * `F11-18`). Ninguna bloquea nada: el portal no envía órdenes, así que una
 * regla sólo dice en qué estado está el día.
 *
 * `trading-rules-2.0.0` (`F11-18`, decisiones del owner del 2026-11-25) parte
 * la cuenta en dos bolsillos según el tipo de cada trade (`trading-book-1.1.0`,
 * automático):
 *
 * - **Swing, 70 % del valor de liquidación:** el valor de mercado de las
 *   posiciones swing contra ese tope; 2 % de riesgo por trade y 6 % de riesgo
 *   abierto, los dos sobre la cartera entera y medidos sólo en las swing.
 * - **Day, el resto:** lo **comprado** hoy en day trades contra el 30 % del
 *   valor de liquidación al abrir. Se cuenta lo comprado y no lo neto porque la
 *   cuenta es `CASH`: lo vendido hoy se liquida en T+1, y volver a comprar con
 *   eso y vender en el día es una good faith violation. 0,5 % de riesgo por
 *   trade. La pérdida diaria, los trades por sesión y la racha cuentan sólo
 *   day trades: el gap de una swing no corta el day trading.
 *
 * Por defecto rigen 70 / 2 / 6 y 0,5, más los límites del día de `1.0.0` (3
 * trades por sesión, corte tras 3 pérdidas) y una pérdida diaria de 1,5 %: tres
 * stops completos de day trading, el máximo de trades por sesión. La `1.0.0`
 * medía 4 % como dos stops al 2 %, que ya no es el riesgo de un day trade.
 * Una revisión guardada con `1.0.0` se lee con sus valores para swing y el día,
 * y con los por defecto para el reparto y el riesgo day, que no tenía.
 *
 * Los estados son tres. `stop`: la regla dice no abrir otro trade de ese tipo.
 * `warning`: un paso más llega a `stop` (otro stop completo no entra en lo que
 * queda, o falta un trade o una pérdida). `ok`, el resto. Los topes de capital
 * no tienen `warning`: ningún monto es «un trade más». Una regla apagada es
 * `off`, y una que no se puede medir, `unknown` con motivo: nunca `ok` por
 * falta de dato.
 */
export const TRADING_RULES_VERSION = "trading-rules-2.0.0";
export const TRADING_RULES_V1 = "trading-rules-1.0.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

const PATH = "trading-rules";
const parse = (value: string) => parseDecimal(value, PATH);
const format = (value: Dec) => formatDecimal(value, PATH);

export type RiskSettings = {
  /** El tope de las posiciones swing; el resto es capital de day trading. */
  readonly swingAllocationPercent: string;
  /** Riesgo de un swing, sobre el valor de liquidación entero. */
  readonly riskPerTradePercent: string;
  /** Riesgo abierto de las swing, sobre el valor de liquidación entero. */
  readonly openRiskPercent: string;
  /** Riesgo de un day trade, sobre el valor de liquidación entero. */
  readonly dayRiskPerTradePercent: string;
  /** Day trades. `null`: la regla está apagada. */
  readonly dailyLossPercent: string | null;
  readonly maxTradesPerSession: number | null;
  readonly maxConsecutiveLosses: number | null;
};

export const DEFAULT_RISK_SETTINGS: RiskSettings = Object.freeze({
  swingAllocationPercent: "70",
  riskPerTradePercent: "2",
  openRiskPercent: "6",
  dayRiskPerTradePercent: "0.5",
  dailyLossPercent: "1.5",
  maxTradesPerSession: 3,
  maxConsecutiveLosses: 3,
});

export const COUNT_RULE_MAX = 20;

const CANONICAL_PERCENT = /^(?:[1-9][0-9]?|100|0)(?:\.[0-9]{0,1}[1-9])?$/u;

const canonicalPercent = z
  .string()
  .regex(CANONICAL_PERCENT)
  .refine((value) => {
    const parsed = Number(value);
    return parsed > 0 && parsed <= 100;
  });

/** El reparto admite 0 (todo day) y 100 (todo swing). */
const canonicalShare = z
  .string()
  .regex(CANONICAL_PERCENT)
  .refine((value) => Number(value) <= 100);

const countRule = z.number().int().min(1).max(COUNT_RULE_MAX);

export const riskSettingsSchema = z
  .object({
    swingAllocationPercent: canonicalShare,
    riskPerTradePercent: canonicalPercent,
    openRiskPercent: canonicalPercent,
    dayRiskPerTradePercent: canonicalPercent,
    dailyLossPercent: canonicalPercent.nullable(),
    maxTradesPerSession: countRule.nullable(),
    maxConsecutiveLosses: countRule.nullable(),
  })
  .strict()
  .refine(
    (settings) =>
      parse(settings.riskPerTradePercent).lessThanOrEqualTo(
        parse(settings.openRiskPercent),
      ),
    { message: "per_trade_above_open", path: ["riskPerTradePercent"] },
  )
  .refine(
    (settings) =>
      settings.dailyLossPercent === null ||
      parse(settings.dayRiskPerTradePercent).lessThanOrEqualTo(
        parse(settings.dailyLossPercent),
      ),
    {
      message: "day_trade_above_daily_loss",
      path: ["dayRiskPerTradePercent"],
    },
  );

/** Un porcentaje como lo escribe el owner: coma o punto, hasta dos decimales. */
function percentInput(required: boolean, allowZero = false) {
  return z
    .string()
    .max(8)
    .transform((value, context) => {
      const trimmed = value.trim().replace(/\s*%$/u, "");
      if (trimmed === "") {
        if (required) {
          context.addIssue({ code: "custom", message: "required" });
          return z.NEVER;
        }
        return null;
      }
      if (!/^[0-9]{1,3}(?:[.,][0-9]{1,2})?$/u.test(trimmed)) {
        context.addIssue({ code: "custom", message: "not_a_percent" });
        return z.NEVER;
      }
      const decimal = parse(trimmed.replace(",", "."));
      if (
        decimal.lessThan(ZERO) ||
        (!allowZero && decimal.isZero()) ||
        decimal.greaterThan(HUNDRED)
      ) {
        context.addIssue({ code: "custom", message: "out_of_range" });
        return z.NEVER;
      }
      return format(decimal);
    });
}

function countInput() {
  return z
    .string()
    .max(4)
    .transform((value, context) => {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      if (!/^[0-9]{1,2}$/u.test(trimmed)) {
        context.addIssue({ code: "custom", message: "not_a_count" });
        return z.NEVER;
      }
      const count = Number(trimmed);
      if (count < 1 || count > COUNT_RULE_MAX) {
        context.addIssue({ code: "custom", message: "out_of_range" });
        return z.NEVER;
      }
      return count;
    });
}

/** El formulario de las reglas, campo por campo; vacío apaga una regla. */
export const riskSettingsFormSchema = z
  .object({
    swingAllocationPercent: percentInput(true, true),
    riskPerTradePercent: percentInput(true),
    openRiskPercent: percentInput(true),
    dayRiskPerTradePercent: percentInput(true),
    dailyLossPercent: percentInput(false),
    maxTradesPerSession: countInput(),
    maxConsecutiveLosses: countInput(),
  })
  .strict()
  .pipe(riskSettingsSchema);

export function sameRiskSettings(a: RiskSettings, b: RiskSettings): boolean {
  return (
    a.swingAllocationPercent === b.swingAllocationPercent &&
    a.riskPerTradePercent === b.riskPerTradePercent &&
    a.openRiskPercent === b.openRiskPercent &&
    a.dayRiskPerTradePercent === b.dayRiskPerTradePercent &&
    a.dailyLossPercent === b.dailyLossPercent &&
    a.maxTradesPerSession === b.maxTradesPerSession &&
    a.maxConsecutiveLosses === b.maxConsecutiveLosses
  );
}

/** El riesgo por trade de cada tipo. */
export function riskPerTradeOf(
  settings: RiskSettings,
  book: TradingBook,
): string {
  return book === "day"
    ? settings.dayRiskPerTradePercent
    : settings.riskPerTradePercent;
}

/** La parte del valor de liquidación que le toca a un tipo, en porcentaje. */
export function allocationOf(
  settings: RiskSettings,
  book: TradingBook,
): string {
  const swing = parse(settings.swingAllocationPercent);
  return format(book === "swing" ? swing : HUNDRED.minus(swing));
}

/** Los day trades de la sesión de Nueva York de hoy, de la base de trading. */
export type SessionActivity = {
  readonly session: string;
  /** Day trades que abrieron en la sesión. */
  readonly tradesOpened: number;
  /** Lo realizado por las salidas de day trades. */
  readonly realized: string;
  /** Las pérdidas seguidas con que termina la sesión, por day trade cerrado. */
  readonly lossStreak: number;
  /** Lo que costaron las compras de day trades de la sesión, con comisiones. */
  readonly dayBuys: string;
};

/**
 * Los day trades de una sesión (`trading-book-1.1.0`): los que abrieron en
 * ella, cerrados o todavía abiertos. Un trade cuenta en la racha cuando cierra:
 * con P&L negativo suma, con cero o positivo la corta. Las salidas de un swing
 * no cuentan: tienen su propio bolsillo.
 */
export function sessionActivity(
  trades: readonly RoundTrip[],
  now: string,
  /** El tipo de la idea unida a cada trade (`trading-book-1.1.0`). */
  plannedBookOf: (trade: RoundTrip) => TradingBook | null = () => null,
): SessionActivity {
  const session = tradingSessionOf(now);
  const day = trades.filter(
    (trade) =>
      trade.status !== "opened_before_history" &&
      trade.openedSession === session &&
      bookOfTrade(trade, session, plannedBookOf(trade)) === "day",
  );
  const realized: Dec[] = [];
  const buys: Dec[] = [];
  for (const trade of day) {
    for (const portion of trade.portions) {
      if (portion.role === "close") {
        if (portion.realizedPnl !== null)
          realized.push(parse(portion.realizedPnl));
      } else if (portion.side === "buy") {
        buys.push(parse(portion.netAmount).negated());
      }
    }
  }
  const closed = day
    .filter((trade) => trade.status === "closed" && trade.realizedPnl !== null)
    .sort((a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!));
  let lossStreak = 0;
  for (const trade of closed) {
    lossStreak = parse(trade.realizedPnl!).lessThan(ZERO) ? lossStreak + 1 : 0;
  }
  return {
    session,
    tradesOpened: day.length,
    realized: format(sum(realized)),
    lossStreak,
    dayBuys: format(sum(buys)),
  };
}

export type TradingRule =
  | "day_capital"
  | "daily_loss"
  | "trades"
  | "loss_streak"
  | "swing_exposure"
  | "open_risk";

export const RULE_BOOK: Readonly<Record<TradingRule, TradingBook>> = {
  day_capital: "day",
  daily_loss: "day",
  trades: "day",
  loss_streak: "day",
  swing_exposure: "swing",
  open_risk: "swing",
};

export type RuleState = "ok" | "warning" | "stop" | "off" | "unknown";
export type RuleUnknownReason =
  "open_risk_incomplete" | "open_day_pnl_unknown" | "no_equity";

export type RuleReading = {
  readonly rule: TradingRule;
  readonly state: RuleState;
  /** Lo usado: dinero en los de dinero, una cuenta en los de conteo. */
  readonly used: string | null;
  readonly limit: string | null;
  readonly reason: RuleUnknownReason | null;
};

/** `oneTrade` `null`: un tope sin `warning`. */
function moneyRule(
  rule: TradingRule,
  used: Dec,
  limit: Dec,
  oneTrade: Dec | null,
): RuleReading {
  const state: RuleState = used.greaterThanOrEqualTo(limit)
    ? "stop"
    : oneTrade !== null && limit.minus(used).lessThan(oneTrade)
      ? "warning"
      : "ok";
  return {
    rule,
    state,
    used: format(used),
    limit: format(limit),
    reason: null,
  };
}

function countRuleReading(
  rule: TradingRule,
  used: number,
  limit: number,
): RuleReading {
  const state: RuleState =
    used >= limit ? "stop" : used === limit - 1 ? "warning" : "ok";
  return {
    rule,
    state,
    used: String(used),
    limit: String(limit),
    reason: null,
  };
}

const unknown = (
  rule: TradingRule,
  reason: RuleUnknownReason,
  limit: string | null = null,
): RuleReading => ({ rule, state: "unknown", used: null, limit, reason });

const off = (rule: TradingRule): RuleReading => ({
  rule,
  state: "off",
  used: null,
  limit: null,
  reason: null,
});

/**
 * Las seis alertas, primero las del día y después las de swing. El riesgo
 * abierto y la pérdida diaria se miden en dinero contra el capital; su
 * `warning` es que otro stop completo del tipo ya no entra en lo que queda.
 */
export function evaluateTradingRules(input: {
  readonly settings: RiskSettings;
  readonly liquidationValue: string;
  readonly liquidationValueAtOpen: string;
  /** Lo que mide el día: el P&L del día de Schwab de las posiciones day. */
  readonly day: {
    /** `null` si a alguna posición day le falta la cifra. */
    readonly openDayPnl: string | null;
  };
  readonly swing: {
    /** `null` si alguna posición swing no tiene riesgo medido. */
    readonly openRisk: string | null;
    /** El valor de mercado de las posiciones swing. */
    readonly exposure: string;
  };
  readonly activity: SessionActivity;
}): RuleReading[] {
  const { settings, activity } = input;
  const equity = parse(input.liquidationValue);
  const equityAtOpen = parse(input.liquidationValueAtOpen);
  const share = (base: Dec, percent: string) =>
    base.times(parse(percent)).div(HUNDRED);

  const readings: RuleReading[] = [];

  if (!equityAtOpen.greaterThan(ZERO)) {
    readings.push(unknown("day_capital", "no_equity"));
  } else {
    readings.push(
      moneyRule(
        "day_capital",
        parse(activity.dayBuys),
        share(equityAtOpen, allocationOf(settings, "day")),
        null,
      ),
    );
  }

  if (settings.dailyLossPercent === null) {
    readings.push(off("daily_loss"));
  } else if (!equityAtOpen.greaterThan(ZERO)) {
    readings.push(unknown("daily_loss", "no_equity"));
  } else {
    const limit = share(equityAtOpen, settings.dailyLossPercent);
    if (input.day.openDayPnl === null) {
      readings.push(
        unknown("daily_loss", "open_day_pnl_unknown", format(limit)),
      );
    } else {
      const day = parse(activity.realized).plus(parse(input.day.openDayPnl));
      // Lo usado es la pérdida; un día en ganancia no usa nada.
      const loss = day.lessThan(ZERO) ? day.negated() : ZERO;
      readings.push(
        moneyRule(
          "daily_loss",
          loss,
          limit,
          share(equityAtOpen, settings.dayRiskPerTradePercent),
        ),
      );
    }
  }

  readings.push(
    settings.maxTradesPerSession === null
      ? off("trades")
      : countRuleReading(
          "trades",
          activity.tradesOpened,
          settings.maxTradesPerSession,
        ),
  );
  readings.push(
    settings.maxConsecutiveLosses === null
      ? off("loss_streak")
      : countRuleReading(
          "loss_streak",
          activity.lossStreak,
          settings.maxConsecutiveLosses,
        ),
  );

  if (!equity.greaterThan(ZERO)) {
    readings.push(unknown("swing_exposure", "no_equity"));
    readings.push(unknown("open_risk", "no_equity"));
    return readings;
  }
  readings.push(
    moneyRule(
      "swing_exposure",
      parse(input.swing.exposure),
      share(equity, allocationOf(settings, "swing")),
      null,
    ),
  );
  const limit = share(equity, settings.openRiskPercent);
  readings.push(
    input.swing.openRisk === null
      ? unknown("open_risk", "open_risk_incomplete", format(limit))
      : moneyRule(
          "open_risk",
          parse(input.swing.openRisk),
          limit,
          share(equity, settings.riskPerTradePercent),
        ),
  );
  return readings;
}

/** Lo usado sobre el límite, de 0 a 1 o más; `null` sin los dos o sin límite. */
export function ruleUsage(reading: RuleReading): number | null {
  if (reading.used === null || reading.limit === null) return null;
  const limit = parse(reading.limit);
  if (!limit.greaterThan(ZERO)) return null;
  return divide(parse(reading.used), limit, PATH).toNumber();
}

/**
 * Lo que le queda a un tope de capital, nunca negativo; `null` si la regla no
 * se midió.
 */
export function capitalLeft(reading: RuleReading | undefined): string | null {
  if (reading === undefined || reading.used === null || reading.limit === null)
    return null;
  const left = parse(reading.limit).minus(parse(reading.used));
  return format(left.lessThan(ZERO) ? ZERO : left);
}

/** Informational rule. The existing sizing limits use only financial inputs. */
export function swingEarningsWarnings(
  positions: readonly {
    readonly symbol: string;
    readonly book: "day" | "swing";
  }[],
  reports: readonly EarningsReport[],
  at: string,
): string[] {
  return [
    ...new Set(
      positions
        .filter(
          ({ symbol, book }) =>
            book === "swing" &&
            nextReportFor(reports, symbol, at, book) !== undefined,
        )
        .map(({ symbol }) => symbol),
    ),
  ].sort();
}
