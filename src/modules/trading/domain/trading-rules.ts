import { z } from "zod";

import {
  createDecimalOperations,
  HUNDRED,
  sum,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { RoundTrip } from "./trade-round-trips";
import { tradingSessionOf } from "./trading-session";

/**
 * Las reglas propias del owner como alertas (`trading-rules-1.0.0`, ADR 0076,
 * sección 9; `F11-09`). Ninguna bloquea nada: el portal no envía órdenes, así
 * que una regla sólo dice en qué estado está el día.
 *
 * Las editables viven en la base de trading como revisiones; sin ninguna
 * guardada rigen estos valores por defecto, elegidos el 2026-11-15 contra los
 * 47 trades reales y la práctica publicada (la regla del 2 % y del 6 % de
 * Elder, límites diarios del 2 al 5 % del capital, la «regla de los tres
 * strikes»):
 *
 * - **2 % por trade y 6 % de riesgo abierto:** el planner del Flask del owner.
 * - **Pérdida diaria 4 %:** dos stops completos al 2 %. Sobre el valor de
 *   liquidación al abrir, con lo realizado en la sesión más lo abierto del día
 *   según Schwab. El peor día medido (−1.319, dos swings) está por debajo.
 * - **3 trades por sesión:** 38 de 39 sesiones con entradas tuvieron una o
 *   dos; el máximo fue tres.
 * - **Corte tras 3 pérdidas seguidas:** la única sesión que lo pasó fueron
 *   seis pérdidas chicas seguidas en TSLA el 2024-06-06.
 *
 * Los estados son tres. `stop`: la regla dice no abrir otro trade. `warning`:
 * un paso más llega a `stop` (otro stop completo no entra en lo que queda, o
 * falta un trade o una pérdida). `ok`, el resto. Una regla apagada es `off`, y
 * una que no se puede medir, `unknown` con motivo: nunca `ok` por falta de dato.
 */
export const TRADING_RULES_VERSION = "trading-rules-1.0.0";

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

const PATH = "trading-rules";
const parse = (value: string) => parseDecimal(value, PATH);
const format = (value: Dec) => formatDecimal(value, PATH);

export type RiskSettings = {
  readonly riskPerTradePercent: string;
  readonly openRiskPercent: string;
  /** `null`: la regla está apagada. */
  readonly dailyLossPercent: string | null;
  readonly maxTradesPerSession: number | null;
  readonly maxConsecutiveLosses: number | null;
};

export const DEFAULT_RISK_SETTINGS: RiskSettings = Object.freeze({
  riskPerTradePercent: "2",
  openRiskPercent: "6",
  dailyLossPercent: "4",
  maxTradesPerSession: 3,
  maxConsecutiveLosses: 3,
});

export const COUNT_RULE_MAX = 20;

const canonicalPercent = z
  .string()
  .regex(/^(?:[1-9][0-9]?|100|0)(?:\.[0-9]{0,1}[1-9])?$/u)
  .refine((value) => {
    const parsed = Number(value);
    return parsed > 0 && parsed <= 100;
  });

const countRule = z.number().int().min(1).max(COUNT_RULE_MAX);

export const riskSettingsSchema = z
  .object({
    riskPerTradePercent: canonicalPercent,
    openRiskPercent: canonicalPercent,
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
  );

/** Un porcentaje como lo escribe el owner: coma o punto, hasta dos decimales. */
function percentInput(required: boolean) {
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
      if (!decimal.greaterThan(ZERO) || decimal.greaterThan(HUNDRED)) {
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
    riskPerTradePercent: percentInput(true),
    openRiskPercent: percentInput(true),
    dailyLossPercent: percentInput(false),
    maxTradesPerSession: countInput(),
    maxConsecutiveLosses: countInput(),
  })
  .strict()
  .pipe(riskSettingsSchema);

export function sameRiskSettings(a: RiskSettings, b: RiskSettings): boolean {
  return (
    a.riskPerTradePercent === b.riskPerTradePercent &&
    a.openRiskPercent === b.openRiskPercent &&
    a.dailyLossPercent === b.dailyLossPercent &&
    a.maxTradesPerSession === b.maxTradesPerSession &&
    a.maxConsecutiveLosses === b.maxConsecutiveLosses
  );
}

/** Lo que hizo la sesión de Nueva York de hoy, de la base de trading. */
export type SessionActivity = {
  readonly session: string;
  /** Trades que abrieron en la sesión. */
  readonly tradesOpened: number;
  /** Lo realizado por las salidas de la sesión que lo conocen. */
  readonly realized: string;
  /** Salidas de trades abiertos antes de la historia: no suman. */
  readonly unknownExits: number;
  /** Las pérdidas seguidas con que termina la sesión, por trade cerrado. */
  readonly lossStreak: number;
};

/**
 * La actividad de una sesión. Un trade cuenta en la racha cuando cierra: con
 * P&L negativo suma, con cero o positivo la corta. Un trade abierto antes de la
 * historia no se sabe si perdió, así que tampoco la corta ni la suma.
 */
export function sessionActivity(
  trades: readonly RoundTrip[],
  now: string,
): SessionActivity {
  const session = tradingSessionOf(now);
  let unknownExits = 0;
  const realized: Dec[] = [];
  for (const trade of trades) {
    for (const portion of trade.portions) {
      if (portion.role !== "close") continue;
      if (tradingSessionOf(portion.executedAt) !== session) continue;
      if (portion.realizedPnl === null) unknownExits += 1;
      else realized.push(parse(portion.realizedPnl));
    }
  }
  const closed = trades
    .filter(
      (trade) =>
        trade.status === "closed" &&
        trade.closedSession === session &&
        trade.realizedPnl !== null,
    )
    .sort((a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!));
  let lossStreak = 0;
  for (const trade of closed) {
    lossStreak = parse(trade.realizedPnl!).lessThan(ZERO) ? lossStreak + 1 : 0;
  }
  return {
    session,
    tradesOpened: trades.filter(
      (trade) =>
        trade.status !== "opened_before_history" &&
        trade.openedSession === session,
    ).length,
    realized: format(sum(realized)),
    unknownExits,
    lossStreak,
  };
}

export type TradingRule = "open_risk" | "daily_loss" | "trades" | "loss_streak";
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

function moneyRule(
  rule: TradingRule,
  used: Dec,
  limit: Dec,
  oneTrade: Dec,
): RuleReading {
  const state: RuleState = used.greaterThanOrEqualTo(limit)
    ? "stop"
    : limit.minus(used).lessThan(oneTrade)
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

/**
 * Las cuatro alertas del día. El riesgo abierto y la pérdida diaria se miden en
 * dinero contra el capital; su `warning` es que otro stop completo al riesgo
 * por trade ya no entra en lo que queda.
 */
export function evaluateTradingRules(input: {
  readonly settings: RiskSettings;
  readonly liquidationValue: string;
  readonly liquidationValueAtOpen: string;
  /** `null` si alguna posición no tiene riesgo medido. */
  readonly openRisk: string | null;
  /** `null` si a alguna posición le falta el P&L del día de Schwab. */
  readonly openDayPnl: string | null;
  readonly activity: SessionActivity;
}): RuleReading[] {
  const { settings, activity } = input;
  const equity = parse(input.liquidationValue);
  const equityAtOpen = parse(input.liquidationValueAtOpen);
  const share = (base: Dec, percent: string) =>
    base.times(parse(percent)).div(HUNDRED);

  const readings: RuleReading[] = [];

  if (!equity.greaterThan(ZERO)) {
    readings.push(unknown("open_risk", "no_equity"));
  } else {
    const limit = share(equity, settings.openRiskPercent);
    readings.push(
      input.openRisk === null
        ? unknown("open_risk", "open_risk_incomplete", format(limit))
        : moneyRule(
            "open_risk",
            parse(input.openRisk),
            limit,
            share(equity, settings.riskPerTradePercent),
          ),
    );
  }

  if (settings.dailyLossPercent === null) {
    readings.push({
      rule: "daily_loss",
      state: "off",
      used: null,
      limit: null,
      reason: null,
    });
  } else if (!equityAtOpen.greaterThan(ZERO)) {
    readings.push(unknown("daily_loss", "no_equity"));
  } else {
    const limit = share(equityAtOpen, settings.dailyLossPercent);
    if (input.openDayPnl === null) {
      readings.push(
        unknown("daily_loss", "open_day_pnl_unknown", format(limit)),
      );
    } else {
      const day = parse(activity.realized).plus(parse(input.openDayPnl));
      // Lo usado es la pérdida; un día en ganancia no usa nada.
      const loss = day.lessThan(ZERO) ? day.negated() : ZERO;
      readings.push(
        moneyRule(
          "daily_loss",
          loss,
          limit,
          share(equityAtOpen, settings.riskPerTradePercent),
        ),
      );
    }
  }

  readings.push(
    settings.maxTradesPerSession === null
      ? { rule: "trades", state: "off", used: null, limit: null, reason: null }
      : countRuleReading(
          "trades",
          activity.tradesOpened,
          settings.maxTradesPerSession,
        ),
  );
  readings.push(
    settings.maxConsecutiveLosses === null
      ? {
          rule: "loss_streak",
          state: "off",
          used: null,
          limit: null,
          reason: null,
        }
      : countRuleReading(
          "loss_streak",
          activity.lossStreak,
          settings.maxConsecutiveLosses,
        ),
  );
  return readings;
}

/** Lo usado sobre el límite, de 0 a 1 o más; `null` sin los dos. */
export function ruleUsage(reading: RuleReading): number | null {
  if (reading.used === null || reading.limit === null) return null;
  const limit = parse(reading.limit);
  if (!limit.greaterThan(ZERO)) return null;
  return divide(parse(reading.used), limit, PATH).toNumber();
}
