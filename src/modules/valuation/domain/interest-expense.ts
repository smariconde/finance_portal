import { parseDecimal, ZERO, type Dec } from "./decimal-policy";
import type {
  FiscalYear,
  LineItemId,
  LineItemValue,
} from "./annual-fundamentals";

/**
 * El gasto de intereses de un ejercicio (`F6-14`,
 * [ADR 0053](../../../../docs/architecture/adr/0053-reported-concept-coverage.md)).
 *
 * Los filers no lo etiquetan igual. Medido sobre 76 no financieras del índice,
 * 53 publican el bruto (`InterestExpense` o `InterestExpenseNonoperating`);
 * Walmart separa el de la deuda (`InterestExpenseDebt`) del de los
 * arrendamientos financieros; Waste Management, Cencora o General Dynamics sólo
 * publican el **neto** de intereses ganados; IDEX y CDW, sólo lo **pagado** en el
 * flujo de caja. `interest-expense-1.0.0` toma la primera base que cierra, en
 * este orden, y la nombra:
 *
 * 1. `gross`: el bruto publicado.
 * 2. `debt_plus_finance_leases`: el de la deuda, más el de los arrendamientos
 *    financieros si se publica. No se solapan: el primero excluye al segundo.
 * 3. `net_nonoperating`: el neto, cuando es un gasto. Subestima el bruto en lo
 *    que la empresa ganó de intereses; decisión del owner del 2026-10-22.
 * 4. `interest_paid`: lo pagado en el ejercicio. Es caja, no devengado.
 *
 * Un neto que es ingreso no es un gasto: no da cobertura, pero sí sirve para
 * pasar del resultado antes de impuestos al EBIT (`netInterestForEbit`). Sin
 * ninguna base, `null`; nunca cero (`TM-05`).
 */
export const INTEREST_EXPENSE_VERSION = "interest-expense-1.0.0";

export type InterestExpenseBasis =
  "gross" | "debt_plus_finance_leases" | "net_nonoperating" | "interest_paid";

export type InterestReading = {
  /** Positivo es gasto. */
  readonly value: Dec;
  readonly basis: InterestExpenseBasis;
  readonly inputs: readonly LineItemValue[];
};

function item(year: FiscalYear | undefined, id: LineItemId) {
  return year?.items[id];
}

function sameCurrency(values: readonly LineItemValue[]): boolean {
  return new Set(values.map((value) => value.currency)).size <= 1;
}

function value(line: LineItemValue): Dec {
  return parseDecimal(line.value, line.item);
}

function grossOrDebt(year: FiscalYear | undefined): InterestReading | null {
  const gross = item(year, "interest_expense");

  if (gross !== undefined) {
    return { value: value(gross), basis: "gross", inputs: [gross] };
  }

  const debt = item(year, "interest_expense_debt");

  if (debt === undefined) {
    return null;
  }

  const leases = item(year, "finance_lease_interest_expense");
  const inputs = leases === undefined ? [debt] : [debt, leases];

  if (!sameCurrency(inputs)) {
    return null;
  }

  return {
    value: inputs.reduce((total, line) => total.plus(value(line)), ZERO),
    basis: "debt_plus_finance_leases",
    inputs,
  };
}

function paid(year: FiscalYear | undefined): InterestReading | null {
  const line = item(year, "interest_paid");

  return line === undefined
    ? null
    : { value: value(line), basis: "interest_paid", inputs: [line] };
}

/** El gasto de intereses para la cobertura. Un neto que es ingreso no cuenta. */
export function interestExpenseOf(
  year: FiscalYear | undefined,
): InterestReading | null {
  const reported = grossOrDebt(year);

  if (reported !== null) {
    return reported;
  }

  const net = item(year, "interest_net_nonoperating");

  // El neto lleva el signo de un ingreso: negativo es un gasto.
  if (net !== undefined && value(net).isNegative()) {
    return {
      value: value(net).negated(),
      basis: "net_nonoperating",
      inputs: [net],
    };
  }

  return paid(year);
}

/**
 * Lo que se le suma al resultado antes de impuestos para llegar al EBIT. Acá el
 * neto vale con cualquier signo: un neto de ingreso se resta, que es lo que el
 * EBIT no incluye.
 */
export function netInterestForEbit(
  year: FiscalYear | undefined,
): InterestReading | null {
  const reported = grossOrDebt(year);

  if (reported !== null) {
    return reported;
  }

  const net = item(year, "interest_net_nonoperating");

  if (net !== undefined) {
    return {
      value: value(net).negated(),
      basis: "net_nonoperating",
      inputs: [net],
    };
  }

  return paid(year);
}
