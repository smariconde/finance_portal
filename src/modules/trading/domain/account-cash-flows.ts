import {
  createDecimalOperations,
  sum,
} from "@/modules/numeric/domain/decimal-policy";

import type { SchwabTransaction } from "./schwab-transactions";
import { tradingSessionOf } from "./trading-session";

/**
 * El dinero que entra o sale de la cuenta sin ser resultado
 * (`account-cash-flow-1.0.0`): un depósito no es ganancia ni un retiro pérdida.
 *
 * Medido el 2026-11-19 sobre las 215 transacciones de la cuenta real:
 *
 * - `CASH_RECEIPT` son las transferencias del owner (15 de 15),
 *   `ELECTRONIC_FUND` las de Wise (5 de 5) y `CASH_DISBURSEMENT` los cajeros
 *   (4 de 4): todos movimientos externos.
 * - `JOURNAL` mezcla dos cosas. La retención de impuestos de un dividendo o un
 *   interés llega en el mismo instante que su `DIVIDEND_OR_INTEREST` (15 de 15)
 *   y es parte del resultado. Las compras con tarjeta y los reintegros de cajero
 *   no tienen par (16 de 16) y son movimientos externos.
 * - `TRADE` y `DIVIDEND_OR_INTEREST` son resultado.
 *
 * Los tipos publicados que no se midieron (`ACH_*`, `WIRE_*`) son externos por
 * nombre; el parser todavía los rechaza, así que no llegan acá.
 */
export const ACCOUNT_CASH_FLOW_VERSION = "account-cash-flow-1.0.0";

const EXTERNAL_TYPES: ReadonlySet<string> = new Set([
  "CASH_RECEIPT",
  "CASH_DISBURSEMENT",
  "ELECTRONIC_FUND",
  "ACH_RECEIPT",
  "ACH_DISBURSEMENT",
  "WIRE_IN",
  "WIRE_OUT",
]);

const { parseDecimal, formatDecimal } = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);
const PATH = "account-cash-flows";

type FlowTransaction = Pick<
  SchwabTransaction,
  "type" | "executedAt" | "netAmount"
>;

/** Las transacciones que son dinero entrando o saliendo, no resultado. */
export function externalCashFlows<T extends FlowTransaction>(
  transactions: readonly T[],
): T[] {
  const incomeInstants = new Set(
    transactions
      .filter((transaction) => transaction.type === "DIVIDEND_OR_INTEREST")
      .map((transaction) => Date.parse(transaction.executedAt)),
  );
  return transactions.filter((transaction) =>
    transaction.type === "JOURNAL"
      ? !incomeInstants.has(Date.parse(transaction.executedAt))
      : EXTERNAL_TYPES.has(transaction.type),
  );
}

/**
 * El neto de depósitos menos retiros de la sesión de Nueva York de `now`:
 * positivo si entró dinero. Cero sin movimientos.
 */
export function sessionCashFlows(
  transactions: readonly FlowTransaction[],
  now: string,
): string {
  const session = tradingSessionOf(now);
  return formatDecimal(
    sum(
      externalCashFlows(transactions)
        .filter(
          (transaction) => tradingSessionOf(transaction.executedAt) === session,
        )
        .map((transaction) => parseDecimal(transaction.netAmount, PATH)),
    ),
    PATH,
  );
}
