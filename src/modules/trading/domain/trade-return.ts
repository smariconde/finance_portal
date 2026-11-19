import {
  createDecimalOperations,
  HUNDRED,
  sum,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import type { FillPortion } from "./trade-round-trips";

/**
 * Retorno porcentual de un trade (`trade-return-1.0.0`): lo realizado sobre el
 * capital que comprometieron las salidas, en puntos porcentuales.
 *
 * - **Base:** el costo FIFO de lo que salió, leído de cada salida como
 *   `|netAmount − realizedPnl|`. En un largo es lo que costaron los lotes
 *   vendidos; en un corto, lo que cobraron los lotes recomprados. Sale de los
 *   `netAmount` de Schwab, así que ya trae comisiones y el multiplicador de una
 *   opción: nunca se recalcula con precio × cantidad.
 * - **Cerrado:** la base es todo lo que entró, y el retorno es el del trade
 *   entero (`whole_trade`).
 * - **Abierto con salidas parciales:** el retorno es el de la parte que salió
 *   (`exited_portion`), nunca el de la posición que sigue abierta.
 * - **Sin dato:** sin salidas, `no_exits`; con una salida sin entrada a la
 *   vista (antes de la historia), `entry_unknown`; con base cero, `zero_basis`.
 *   Nunca un cero ni un infinito.
 */
export const TRADE_RETURN_VERSION = "trade-return-1.0.0";

export type TradeReturnReason = "no_exits" | "entry_unknown" | "zero_basis";

export type TradeReturn =
  | {
      /** Puntos porcentuales: `5.25` es 5,25 %. */
      readonly percent: string;
      readonly scope: "whole_trade" | "exited_portion";
      readonly reason: null;
    }
  | {
      readonly percent: null;
      readonly scope: null;
      readonly reason: TradeReturnReason;
    };

const { parseDecimal, divide, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

const PATH = "trade-return";

export function tradeReturnOf(trade: {
  readonly status: "open" | "closed" | "opened_before_history";
  readonly portions: readonly Pick<
    FillPortion,
    "role" | "netAmount" | "realizedPnl"
  >[];
}): TradeReturn {
  const exits = trade.portions.filter((portion) => portion.role === "close");
  if (exits.length === 0) {
    return { percent: null, scope: null, reason: "no_exits" };
  }
  if (
    trade.status === "opened_before_history" ||
    exits.some((portion) => portion.realizedPnl === null)
  ) {
    return { percent: null, scope: null, reason: "entry_unknown" };
  }

  const realized = sum(
    exits.map((portion) => parseDecimal(portion.realizedPnl!, PATH)),
  );
  const basis = sum(
    exits.map((portion) =>
      parseDecimal(portion.netAmount, PATH)
        .minus(parseDecimal(portion.realizedPnl!, PATH))
        .abs(),
    ),
  );
  if (!basis.greaterThan(ZERO)) {
    return { percent: null, scope: null, reason: "zero_basis" };
  }

  return {
    percent: formatDecimal(divide(realized.times(HUNDRED), basis, PATH), PATH),
    scope: trade.status === "closed" ? "whole_trade" : "exited_portion",
    reason: null,
  };
}
