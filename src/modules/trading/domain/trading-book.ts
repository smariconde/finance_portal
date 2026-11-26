import {
  createDecimalOperations,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import type { RoundTrip } from "./trade-round-trips";

/**
 * Day o swing (`trading-book-1.0.0`, `F11-18`). Decisión del owner del
 * 2026-11-25: el tipo es **automático**, nunca declarado. Un trade es day
 * mientras vive dentro de una sola sesión de Nueva York: cerró en la sesión en
 * que abrió o, abierto, abrió en la de hoy. Lo que pasa la noche es swing desde
 * la sesión siguiente, también un trade abierto antes de la historia.
 *
 * La consecuencia es buscada: una compra pensada como swing usa el capital del
 * day trading el día que entra, y pasa al de swing al día siguiente.
 */
export const TRADING_BOOK_VERSION = "trading-book-1.0.0";

export type TradingBook = "day" | "swing";

export const TRADING_BOOKS: readonly TradingBook[] = ["day", "swing"];

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

export function bookOfTrade(
  trade: Pick<RoundTrip, "status" | "openedSession" | "closedSession">,
  session: string,
): TradingBook {
  if (trade.status === "opened_before_history") return "swing";
  return trade.openedSession === (trade.closedSession ?? session)
    ? "day"
    : "swing";
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
