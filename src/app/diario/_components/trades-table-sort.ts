import {
  compareDecimalText,
  compareNullsLast,
  type SortDirection,
  type SortState,
} from "@/app/_components/data-table/table-sort";
import type { JournalEntry } from "@/modules/trading/domain/journal";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";

/** En qué se lee el resultado de cada trade: dólares o retorno. */
export type ResultUnit = "money" | "percent";

export type TradeSortKey =
  "symbol" | "result" | "r" | "opened" | "closed" | "days" | "fees";

/** Texto de A a Z; fechas y cifras, de lo último o lo mayor primero. */
export function firstTradeSortDirection(key: TradeSortKey): SortDirection {
  return key === "symbol" ? "ascending" : "descending";
}

export const DEFAULT_TRADE_SORT: SortState<TradeSortKey> = {
  key: "closed",
  direction: "descending",
};

/** Días de calendario entre la sesión de entrada y la de salida. */
export function daysHeld(trade: RoundTrip): number | null {
  if (trade.closedSession === null || trade.status !== "closed") return null;
  return Math.round(
    (Date.parse(trade.closedSession) - Date.parse(trade.openedSession)) /
      86_400_000,
  );
}

/**
 * El P&L que se muestra: un trade abierto sin salidas todavía no realizó nada,
 * y un `0,00` se leería como resultado.
 */
export function displayedPnl(trade: RoundTrip): string | null {
  if (trade.status === "open" && trade.averageExitPrice === null) return null;
  return trade.realizedPnl;
}

/** Lo último arriba: un trade abierto es más reciente que cualquier salida. */
function byRecency(left: RoundTrip, right: RoundTrip): number {
  const closed =
    (right.closedAt === null ? Infinity : Date.parse(right.closedAt)) -
    (left.closedAt === null ? Infinity : Date.parse(left.closedAt));
  if (closed !== 0 && !Number.isNaN(closed)) return closed;
  return (
    Date.parse(right.openedAt) - Date.parse(left.openedAt) ||
    left.tradeId.localeCompare(right.tradeId)
  );
}

function resultOf(
  trade: RoundTrip,
  entry: JournalEntry | undefined,
  unit: ResultUnit,
): string | null {
  return unit === "money"
    ? displayedPnl(trade)
    : (entry?.return.percent ?? null);
}

/**
 * Ordena los trades por la columna elegida. Lo que no tiene la cifra —un trade
 * sin salidas, sin stop o anterior a la historia— va siempre al final, en los
 * dos sentidos; un empate cae en el orden por recencia, así la tabla no
 * baila entre renders.
 */
export function sortTrades(
  trades: readonly RoundTrip[],
  entries: Readonly<Record<string, JournalEntry>>,
  sort: SortState<TradeSortKey>,
  unit: ResultUnit,
): RoundTrip[] {
  const { direction } = sort;
  const compare = (left: RoundTrip, right: RoundTrip): number => {
    switch (sort.key) {
      case "symbol":
        return compareNullsLast(left.symbol, right.symbol, direction, (a, b) =>
          a.localeCompare(b, "es"),
        );
      case "result":
        return compareNullsLast(
          resultOf(left, entries[left.tradeId], unit),
          resultOf(right, entries[right.tradeId], unit),
          direction,
          compareDecimalText,
        );
      case "r":
        return compareNullsLast(
          entries[left.tradeId]?.r.value ?? null,
          entries[right.tradeId]?.r.value ?? null,
          direction,
          compareDecimalText,
        );
      case "opened":
        return compareNullsLast(
          left.status === "opened_before_history" ? null : left.openedAt,
          right.status === "opened_before_history" ? null : right.openedAt,
          direction,
          (a, b) => Date.parse(a) - Date.parse(b),
        );
      case "closed": {
        const order = -byRecency(left, right);
        return direction === "ascending" ? order : -order;
      }
      case "days":
        return compareNullsLast(
          daysHeld(left),
          daysHeld(right),
          direction,
          (a, b) => a - b,
        );
      case "fees":
        return compareNullsLast(
          left.fees,
          right.fees,
          direction,
          compareDecimalText,
        );
    }
  };

  return [...trades].sort(
    (left, right) => compare(left, right) || byRecency(left, right),
  );
}
