import {
  createDecimalOperations,
  sum,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import type { SchwabTransaction } from "./schwab-transactions";
import {
  buildRoundTrips,
  type RoundTrip,
  type TradeFill,
} from "./trade-round-trips";

/**
 * El diario a partir de las transacciones guardadas (`trading-journal-1.0.0`,
 * `F11-05`): las ejecuciones de cada `TRADE` vigente, los trades FIFO y un
 * resumen de lo cerrado. Las estadísticas en R son `F11-08`; acá sólo se cuenta
 * y se suma dinero.
 */
export const JOURNAL_VERSION = "trading-journal-1.0.0";

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code) => new Error(code),
);

/** Una acción o un ETF: el multiplicador es 1 (no hay opciones medidas). */
const MULTIPLIER = "1";

export function fillsFromTransactions(
  accountKey: string,
  transactions: readonly (SchwabTransaction & { readonly state?: string })[],
): TradeFill[] {
  return transactions.flatMap((transaction) => {
    if (transaction.type !== "TRADE" || transaction.instrument === null)
      return [];
    if (transaction.state === "withdrawn") return [];
    const instrument = transaction.instrument;
    const selling = instrument.quantity.startsWith("-");
    return [
      {
        fillId: transaction.activityId,
        accountKey,
        // El ID de Schwab sobrevive a un cambio de ticker; el símbolo, no.
        instrumentKey: `schwab:${instrument.instrumentId}`,
        symbol: instrument.symbol,
        assetType: instrument.assetType,
        multiplier: MULTIPLIER,
        currency: "USD",
        side: selling ? "sell" : "buy",
        quantity: selling ? instrument.quantity.slice(1) : instrument.quantity,
        // Sin precio, la entrada promedio no se puede leer: cero la falsearía.
        price: instrument.price ?? "0",
        netAmount: transaction.netAmount,
        fees: transaction.fees,
        executedAt: transaction.executedAt,
        positionEffect:
          instrument.positionEffect === "OPENING"
            ? "opening"
            : instrument.positionEffect === "CLOSING"
              ? "closing"
              : null,
      },
    ];
  });
}

export type JournalPoint = {
  readonly tradeId: string;
  readonly symbol: string;
  readonly closedAt: string;
  readonly closedSession: string;
  readonly pnl: string;
  readonly cumulative: string;
};

export type JournalSummary = {
  readonly closed: number;
  readonly open: number;
  readonly beforeHistory: number;
  readonly winners: number;
  readonly losers: number;
  readonly breakeven: number;
  readonly dayTrades: number;
  readonly swingTrades: number;
  readonly realizedPnl: string;
  readonly fees: string;
  /** P&L realizado acumulado, un punto por trade cerrado, en orden de cierre. */
  readonly curve: readonly JournalPoint[];
};

export function summarizeJournal(trades: readonly RoundTrip[]): JournalSummary {
  const closed = trades
    .filter((trade) => trade.status === "closed")
    .sort(
      (a, b) =>
        Date.parse(a.closedAt!) - Date.parse(b.closedAt!) ||
        a.tradeId.localeCompare(b.tradeId),
    );
  const path = "journal";
  let running = ZERO;
  const curve = closed.map((trade) => {
    running = running.plus(parseDecimal(trade.realizedPnl!, path));
    return {
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      closedAt: trade.closedAt!,
      closedSession: trade.closedSession!,
      pnl: trade.realizedPnl!,
      cumulative: formatDecimal(running, path),
    };
  });
  const pnl = closed.map((trade) => parseDecimal(trade.realizedPnl!, path));

  return {
    closed: closed.length,
    open: trades.filter((trade) => trade.status === "open").length,
    beforeHistory: trades.filter(
      (trade) => trade.status === "opened_before_history",
    ).length,
    winners: pnl.filter((value) => value.greaterThan(ZERO)).length,
    losers: pnl.filter((value) => value.lessThan(ZERO)).length,
    breakeven: pnl.filter((value) => value.isZero()).length,
    dayTrades: closed.filter((trade) => trade.dayTrade).length,
    swingTrades: closed.filter((trade) => !trade.dayTrade).length,
    realizedPnl: formatDecimal(sum(pnl), path),
    fees: formatDecimal(
      sum(
        trades
          .filter((trade) => trade.fees !== null)
          .map((trade) => parseDecimal(trade.fees!, path)),
      ),
      path,
    ),
    curve,
  };
}

export function buildJournal(
  accountKey: string,
  transactions: readonly (SchwabTransaction & { readonly state?: string })[],
): { readonly trades: RoundTrip[]; readonly summary: JournalSummary } {
  const trades = buildRoundTrips(
    fillsFromTransactions(accountKey, transactions),
  );
  return { trades, summary: summarizeJournal(trades) };
}
