import {
  createDecimalOperations,
  sum,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import { tradingSessionOf } from "./trading-session";

/**
 * Trades del diario armados desde ejecuciones (`trade-round-trip-fifo-1.0.0`,
 * ADR 0076, sección 9).
 *
 * - **Trade:** un ciclo de posición por cuenta e instrumento, desde que sale de
 *   cero hasta que vuelve a cero. Entradas, aumentos y salidas parciales son del
 *   mismo trade, que es como el owner lo opera y lo anota.
 * - **FIFO:** las salidas consumen los lotes abiertos en el orden en que
 *   entraron. Decide el P&L realizado de un trade todavía abierto; uno cerrado
 *   realiza todo.
 * - **Dinero:** sólo el `netAmount` de Schwab, que ya trae comisiones, tasas y
 *   el multiplicador de una opción. Una ejecución que cruza de largo a corto se
 *   parte por cantidad; cada parte lleva su prorrata redondeada al centavo y la
 *   última, el resto, así que las partes suman exactamente el original.
 * - **Invariante:** el P&L de un trade cerrado es exactamente la suma de los
 *   `netAmount` que consumió.
 *
 * - **Antes de la historia:** Schwab devuelve como mucho unos años. Una salida
 *   (`positionEffect` de cierre) sin entrada que la explique es un trade abierto
 *   antes de la historia: queda `opened_before_history`, con el P&L en `null`,
 *   nunca leído como un corto.
 *
 * El multiplicador sólo viaja para mostrar y para R (`F11-06`); nunca reescala
 * un importe de Schwab.
 */
export const ROUND_TRIP_VERSION = "trade-round-trip-fifo-1.0.0";

export class RoundTripError extends Error {
  constructor(
    readonly code:
      | "decimal_invalid"
      | "non_positive_quantity"
      | "currency_mismatch"
      | "instrument_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "RoundTripError";
  }
}

const { parseDecimal, divide, formatDecimal, toFixedScale } =
  createDecimalOperations(
    (code, message) =>
      new RoundTripError("decimal_invalid", `${code}: ${message}`),
  );

export type TradeFill = {
  /** Identidad estable de la ejecución (la transacción de Schwab). */
  readonly fillId: string;
  readonly accountKey: string;
  /** Lo que identifica al instrumento para emparejar: símbolo y tipo, o CUSIP. */
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly assetType: string;
  readonly multiplier: string;
  readonly currency: string;
  readonly side: "buy" | "sell";
  /** Positiva: el lado lo dice `side`. */
  readonly quantity: string;
  readonly price: string;
  /** Efecto en caja con signo: una compra es negativa. Ya neto de comisiones. */
  readonly netAmount: string;
  /** Comisiones y tasas, positivas; `null` si Schwab no las separa. */
  readonly fees: string | null;
  readonly executedAt: string;
  /** Lo que Schwab dice que hizo la ejecución; `null` si no lo dice. */
  readonly positionEffect: "opening" | "closing" | null;
};

export type FillPortion = {
  readonly fillId: string;
  readonly side: "buy" | "sell";
  readonly role: "open" | "close";
  readonly quantity: string;
  readonly price: string;
  readonly netAmount: string;
  readonly executedAt: string;
};

export type RoundTrip = {
  readonly tradeId: string;
  readonly accountKey: string;
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly assetType: string;
  readonly multiplier: string;
  readonly currency: string;
  readonly direction: "long" | "short";
  readonly status: "open" | "closed" | "opened_before_history";
  /** En un trade abierto antes de la historia, la primera salida que se ve. */
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly openedSession: string;
  readonly closedSession: string | null;
  /** Cerrado en la misma sesión de Nueva York en que abrió. */
  readonly dayTrade: boolean;
  /** Cantidad total que entró al trade (entradas más aumentos). */
  readonly entryQuantity: string;
  /** Lo que sigue abierto; `0` en un trade cerrado. */
  readonly openQuantity: string;
  /** Promedio ponderado de las entradas; `null` sin entradas a la vista. */
  readonly averageEntryPrice: string | null;
  /** Promedio ponderado de las salidas; `null` sin salidas. */
  readonly averageExitPrice: string | null;
  /**
   * Cerrado: suma de los `netAmount`. Abierto: lo realizado por FIFO. `null` si
   * la entrada es anterior a la historia.
   */
  readonly realizedPnl: string | null;
  /** `null` si alguna ejecución no separa comisiones. */
  readonly fees: string | null;
  readonly portions: readonly FillPortion[];
};

type Lot = { quantity: Dec; perUnitNet: Dec };

type OpenCycle = {
  direction: "long" | "short";
  firstFillId: string;
  fill: TradeFill;
  lots: Lot[];
  portions: FillPortion[];
  realized: Dec;
  feesKnown: boolean;
  fees: Dec;
};

const CENTS = 2;

/** Parte un importe por cantidad: la parte va al centavo, el resto queda. */
function prorate(net: Dec, part: Dec, whole: Dec, path: string): Dec {
  return parseDecimal(
    toFixedScale(divide(net.times(part), whole, path), CENTS, path),
    path,
  );
}

function weightedAverage(
  portions: readonly FillPortion[],
  path: string,
): string | null {
  const quantity = sum(portions.map((p) => parseDecimal(p.quantity, path)));
  if (quantity.isZero()) return null;
  const notional = sum(
    portions.map((p) =>
      parseDecimal(p.quantity, path).times(parseDecimal(p.price, path)),
    ),
  );
  return formatDecimal(divide(notional, quantity, path), path);
}

function finish(cycle: OpenCycle, closedAt: string | null): RoundTrip {
  const path = `trade:${cycle.firstFillId}`;
  const opens = cycle.portions.filter((p) => p.role === "open");
  const closes = cycle.portions.filter((p) => p.role === "close");
  const openQuantity = sum(cycle.lots.map((lot) => lot.quantity));
  const closed = closedAt !== null;
  const openedAt = opens[0]!.executedAt;
  const openedSession = tradingSessionOf(openedAt);
  const closedSession = closed ? tradingSessionOf(closedAt) : null;

  return {
    tradeId: `${cycle.fill.accountKey}:${cycle.fill.instrumentKey}:${cycle.firstFillId}`,
    accountKey: cycle.fill.accountKey,
    instrumentKey: cycle.fill.instrumentKey,
    symbol: cycle.fill.symbol,
    assetType: cycle.fill.assetType,
    multiplier: cycle.fill.multiplier,
    currency: cycle.fill.currency,
    direction: cycle.direction,
    status: closed ? "closed" : "open",
    openedAt,
    closedAt,
    openedSession,
    closedSession,
    dayTrade: closedSession === openedSession,
    entryQuantity: formatDecimal(
      sum(opens.map((p) => parseDecimal(p.quantity, path))),
      path,
    ),
    openQuantity: formatDecimal(openQuantity, path),
    averageEntryPrice: weightedAverage(opens, path),
    averageExitPrice: weightedAverage(closes, path),
    realizedPnl: formatDecimal(
      closed
        ? sum(cycle.portions.map((p) => parseDecimal(p.netAmount, path)))
        : cycle.realized,
      path,
    ),
    fees: cycle.feesKnown ? formatDecimal(cycle.fees, path) : null,
    portions: cycle.portions,
  };
}

function byExecution(a: TradeFill, b: TradeFill): number {
  return (
    Date.parse(a.executedAt) - Date.parse(b.executedAt) ||
    a.fillId.localeCompare(b.fillId, "en", { numeric: true })
  );
}

/**
 * Los trades de un conjunto de ejecuciones, en orden de apertura. Las
 * ejecuciones pueden venir en cualquier orden y de varias cuentas e
 * instrumentos; se emparejan por `accountKey` e `instrumentKey`.
 */
export function buildRoundTrips(fills: readonly TradeFill[]): RoundTrip[] {
  const trades: RoundTrip[] = [];
  const cycles = new Map<string, OpenCycle>();

  for (const fill of [...fills].sort(byExecution)) {
    const path = `fill:${fill.fillId}`;
    const quantity = parseDecimal(fill.quantity, path);
    if (!quantity.greaterThan(ZERO)) {
      throw new RoundTripError(
        "non_positive_quantity",
        `Fill ${fill.fillId} has a non-positive quantity.`,
      );
    }
    const net = parseDecimal(fill.netAmount, path);
    const fees = fill.fees === null ? null : parseDecimal(fill.fees, path);
    const key = `${fill.accountKey}\u0000${fill.instrumentKey}`;
    const incoming = fill.side === "buy" ? "long" : "short";

    let remaining = quantity;
    let remainingNet = net;
    let remainingFees = fees;

    const take = (part: Dec): { net: Dec; fees: Dec | null } => {
      // La última parte se lleva el resto: las partes suman el original.
      if (part.equals(remaining)) {
        return { net: remainingNet, fees: remainingFees };
      }
      const partNet = prorate(net, part, quantity, path);
      const partFees =
        fees === null ? null : prorate(fees, part, quantity, path);
      return { net: partNet, fees: partFees };
    };

    let cycle = cycles.get(key);
    if (cycle !== undefined) {
      if (cycle.fill.currency !== fill.currency) {
        throw new RoundTripError(
          "currency_mismatch",
          `Fill ${fill.fillId} changes the currency of an open trade.`,
        );
      }
      if (cycle.fill.multiplier !== fill.multiplier) {
        throw new RoundTripError(
          "instrument_mismatch",
          `Fill ${fill.fillId} changes the multiplier of an open trade.`,
        );
      }
    }

    // Una ejecución en contra de la posición la cierra por FIFO.
    if (cycle !== undefined && cycle.direction !== incoming) {
      const open = sum(cycle.lots.map((lot) => lot.quantity));
      const closing = minimum(remaining, open);
      const part = take(closing);

      let toClose = closing;
      let cost = ZERO;
      while (toClose.greaterThan(ZERO)) {
        const lot = cycle.lots[0]!;
        const used = minimum(lot.quantity, toClose);
        cost = cost.plus(lot.perUnitNet.times(used));
        lot.quantity = lot.quantity.minus(used);
        toClose = toClose.minus(used);
        if (lot.quantity.isZero()) cycle.lots.shift();
      }
      cycle.realized = cycle.realized.plus(part.net).plus(cost);
      cycle.portions.push({
        fillId: fill.fillId,
        side: fill.side,
        role: "close",
        quantity: formatDecimal(closing, path),
        price: fill.price,
        netAmount: formatDecimal(part.net, path),
        executedAt: fill.executedAt,
      });
      if (part.fees === null) cycle.feesKnown = false;
      else cycle.fees = cycle.fees.plus(part.fees);

      remaining = remaining.minus(closing);
      remainingNet = remainingNet.minus(part.net);
      remainingFees =
        remainingFees === null || part.fees === null
          ? null
          : remainingFees.minus(part.fees);

      if (cycle.lots.length === 0) {
        trades.push(finish(cycle, fill.executedAt));
        cycles.delete(key);
        cycle = undefined;
      }
    }

    if (remaining.isZero()) continue;

    // Una salida sin entrada a la vista: el trade abrió antes de la historia.
    if (fill.positionEffect === "closing" && cycle === undefined) {
      const part = take(remaining);
      trades.push(beforeHistory(fill, remaining, part.net, part.fees, path));
      continue;
    }

    // Lo que queda abre un trade nuevo o aumenta el abierto.
    const part = take(remaining);
    if (cycle === undefined) {
      cycle = {
        direction: incoming,
        firstFillId: fill.fillId,
        fill,
        lots: [],
        portions: [],
        realized: ZERO,
        feesKnown: true,
        fees: ZERO,
      };
      cycles.set(key, cycle);
    }
    cycle.lots.push({
      quantity: remaining,
      perUnitNet: divide(part.net, remaining, path),
    });
    cycle.portions.push({
      fillId: fill.fillId,
      side: fill.side,
      role: "open",
      quantity: formatDecimal(remaining, path),
      price: fill.price,
      netAmount: formatDecimal(part.net, path),
      executedAt: fill.executedAt,
    });
    if (part.fees === null) cycle.feesKnown = false;
    else cycle.fees = cycle.fees.plus(part.fees);
  }

  for (const cycle of cycles.values()) trades.push(finish(cycle, null));

  return trades.sort(
    (a, b) =>
      Date.parse(a.openedAt) - Date.parse(b.openedAt) ||
      a.tradeId.localeCompare(b.tradeId),
  );
}

function beforeHistory(
  fill: TradeFill,
  quantity: Dec,
  net: Dec,
  fees: Dec | null,
  path: string,
): RoundTrip {
  const session = tradingSessionOf(fill.executedAt);
  return {
    tradeId: `${fill.accountKey}:${fill.instrumentKey}:${fill.fillId}:before`,
    accountKey: fill.accountKey,
    instrumentKey: fill.instrumentKey,
    symbol: fill.symbol,
    assetType: fill.assetType,
    multiplier: fill.multiplier,
    currency: fill.currency,
    // Una venta que cierra cerraba un largo; una compra que cierra, un corto.
    direction: fill.side === "sell" ? "long" : "short",
    status: "opened_before_history",
    openedAt: fill.executedAt,
    closedAt: fill.executedAt,
    openedSession: session,
    closedSession: session,
    dayTrade: false,
    entryQuantity: "0",
    openQuantity: "0",
    averageEntryPrice: null,
    averageExitPrice: fill.price,
    realizedPnl: null,
    fees: fees === null ? null : formatDecimal(fees, path),
    portions: [
      {
        fillId: fill.fillId,
        side: fill.side,
        role: "close",
        quantity: formatDecimal(quantity, path),
        price: fill.price,
        netAmount: formatDecimal(net, path),
        executedAt: fill.executedAt,
      },
    ],
  };
}

function minimum(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}
