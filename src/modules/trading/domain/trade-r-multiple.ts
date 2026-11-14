import {
  createDecimalOperations,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * R de un trade (`trade-r-multiple-1.0.0`, ADR 0076, sección 9): el P&L sobre el
 * riesgo inicial, `|entrada − stop| × cantidad × multiplicador`.
 *
 * - **Entrada y cantidad** son las del trade: el promedio ponderado de sus
 *   entradas y todo lo que entró, porque el riesgo es el de la posición entera,
 *   aumentos incluidos.
 * - **Stop** es el planeado por el owner (`F11-07`). Sin stop, R es `null` con
 *   `no_planned_stop`, nunca cero.
 * - **Un stop del lado equivocado** (sobre la entrada de un largo, bajo la de un
 *   corto) no es un riesgo: `null` con `stop_on_wrong_side`. Igual a la entrada,
 *   `zero_risk`: dividir por cero no es un R.
 */
export const R_MULTIPLE_VERSION = "trade-r-multiple-1.0.0";

export type PlannedStop = {
  readonly price: string;
  readonly currency: string;
};

export type RMultipleReason =
  | "no_planned_stop"
  | "pnl_unknown"
  | "entry_unknown"
  | "currency_mismatch"
  | "stop_on_wrong_side"
  | "zero_risk";

export type RMultipleInput = {
  readonly direction: "long" | "short";
  readonly currency: string;
  readonly averageEntryPrice: string | null;
  readonly entryQuantity: string;
  readonly multiplier: string;
};

export type InitialRisk =
  | { readonly value: Dec; readonly reason: null }
  | { readonly value: null; readonly reason: RMultipleReason };

export type RMultiple =
  | { readonly value: string; readonly reason: null }
  | { readonly value: null; readonly reason: RMultipleReason };

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

/** El riesgo inicial en dinero, o por qué no hay. */
export function initialRiskOf(
  trade: RMultipleInput,
  stop: PlannedStop | null,
): InitialRisk {
  if (stop === null) return { value: null, reason: "no_planned_stop" };
  if (stop.currency !== trade.currency) {
    return { value: null, reason: "currency_mismatch" };
  }
  if (trade.averageEntryPrice === null) {
    return { value: null, reason: "entry_unknown" };
  }
  const path = "r-multiple";
  const entry = parseDecimal(trade.averageEntryPrice, path);
  const stopPrice = parseDecimal(stop.price, path);
  const perUnit =
    trade.direction === "long"
      ? entry.minus(stopPrice)
      : stopPrice.minus(entry);
  if (perUnit.isZero()) return { value: null, reason: "zero_risk" };
  if (perUnit.lessThan(ZERO)) {
    return { value: null, reason: "stop_on_wrong_side" };
  }
  const quantity = parseDecimal(trade.entryQuantity, path);
  const multiplier = parseDecimal(trade.multiplier, path);
  const risk = perUnit.times(quantity).times(multiplier);
  if (!risk.greaterThan(ZERO)) return { value: null, reason: "zero_risk" };
  return { value: risk, reason: null };
}

/** Un importe en R contra un riesgo ya resuelto. */
export function inR(pnl: string | null, risk: InitialRisk): RMultiple {
  if (risk.value === null) return { value: null, reason: risk.reason };
  if (pnl === null) return { value: null, reason: "pnl_unknown" };
  const path = "r-multiple";
  return {
    value: formatDecimal(
      divide(parseDecimal(pnl, path), risk.value, path),
      path,
    ),
    reason: null,
  };
}

export function rMultipleOf(
  trade: RMultipleInput & { readonly realizedPnl: string | null },
  stop: PlannedStop | null,
): RMultiple {
  return inR(trade.realizedPnl, initialRiskOf(trade, stop));
}
