import {
  createDecimalOperations,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import type { RoundTrip } from "./trade-round-trips";

/**
 * Day o swing (`F11-18`). `trading-book-1.0.0` (owner, 2026-11-25) era sólo
 * automático: un trade es day mientras vive dentro de una sola sesión de Nueva
 * York —cerró en la sesión en que abrió o, abierto, abrió en la de hoy— y lo que
 * pasa la noche es swing desde la sesión siguiente, también un trade abierto
 * antes de la historia.
 *
 * `trading-book-1.1.0` (owner, 2026-11-27, operando un swing de MELI que el
 * 1.0.0 cargaba al capital day): **manda el plan**. Un trade unido a una idea
 * swing de `/plan` es swing desde la entrada. Pasar la noche lo hace swing
 * siempre, aunque la idea dijera day: la exposición nocturna es real. Sin idea
 * unida, sigue la regla automática.
 */
export const TRADING_BOOK_VERSION = "trading-book-1.1.0";

export type TradingBook = "day" | "swing";

export const TRADING_BOOKS: readonly TradingBook[] = ["day", "swing"];

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export function bookOfTrade(
  trade: Pick<RoundTrip, "status" | "openedSession" | "closedSession">,
  session: string,
  /** El tipo de la idea de `/plan` unida al trade; `null` sin idea. */
  planned: TradingBook | null = null,
): TradingBook {
  if (trade.status === "opened_before_history") return "swing";
  if (trade.openedSession !== (trade.closedSession ?? session)) return "swing";
  return planned ?? "day";
}

/**
 * El tipo de una posición de Schwab. Manda el trade abierto del diario; sin él
 * (la compra todavía no se sincronizó, o es anterior a la historia), la cantidad
 * que Schwab dice que había al cierre de la sesión anterior: con algo, swing.
 * Sin ese dato tampoco, es day: lo que no tiene historia ni cantidad previa es
 * una compra de hoy.
 */
export function bookOfPosition(input: {
  readonly trade: TradingBook | null;
  readonly previousSessionQuantity: string | null;
}): TradingBook {
  if (input.trade !== null) return input.trade;
  if (input.previousSessionQuantity === null) return "day";
  return parseDecimal(
    input.previousSessionQuantity,
    "trading-book",
  ).greaterThan(ZERO)
    ? "swing"
    : "day";
}

/** El valor de mercado de un grupo de posiciones, como lo publica Schwab. */
export function marketValueOf(
  positions: readonly { readonly marketValue: string }[],
): string {
  return formatDecimal(
    positions.reduce(
      (total, position) =>
        total.plus(parseDecimal(position.marketValue, "trading-book")),
      ZERO,
    ),
    "trading-book",
  );
}
