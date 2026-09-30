import {
  createDecimalOperations,
  ONE,
  ZERO,
  type Dec,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";

import { MetricInputError } from "./metric-input-error";

/**
 * Retorno diario con dividendos reinvertidos, sobre la serie **cruda**
 * ([ADR 0028](../../../../docs/architecture/adr/0028-sortino-parameters-total-return.md)).
 *
 * Cada retorno se expresa en la base de la rueda anterior: quien tenía una
 * acción al cierre de `t−1` tiene al cierre de `t` las acciones que le dieron
 * los splits del intervalo, y cobró los dividendos cuyo ex-date cayó en él.
 *
 * ```text
 * r_t = ( P_t × Π ratio(s)  +  Σ D_d × Π ratio(s) ) / P_{t−1} − 1
 *              s ∈ (t−1, t]         d ∈ (t−1, t]   s ∈ (t−1, d]
 * ```
 *
 * El dividendo se reinvierte al cierre de su ex-date, que es la convención de un
 * índice total return como `^SP500TR`: la referencia y las empresas quedan en la
 * misma base. Un evento fechado en un día sin rueda —feriado, fin de semana— cae
 * en el primer cierre posterior, que es cuando el mercado lo refleja.
 *
 * Exige que cierres y dividendos estén en la misma base, que es lo que garantiza
 * `price-unadjust-1.1.0`: con la `1.0.0`, un dividendo anterior a un split venía
 * dividido por él y este retorno lo habría subestimado.
 */
export const TOTAL_RETURN_FORMULA_VERSION = "total-return-1.0.0";

export type ReturnClose = {
  readonly marketDate: string;
  readonly close: string;
  readonly currency: string;
};

export type ReturnEvent = {
  readonly eventType: "split" | "dividend";
  readonly effectiveOn: string;
  readonly value: string;
  readonly currency: string | null;
};

export type DailyReturn = {
  /** Rueda cuyo cierre cierra el período. */
  readonly marketDate: string;
  /** Decimal canónico: `0.0125` es un 1,25 %. */
  readonly value: string;
};

/**
 * Lo que impide calcular un retorno sin que sea un error del contrato: la serie
 * existe, pero no se puede componer. La fórmula que la consume lo devuelve como
 * `null` con motivo.
 */
export type TotalReturnUnavailable =
  /** Dos monedas en la serie, o un dividendo en otra moneda que el cierre. */
  | "currency_mismatch"
  /** Un cierre en cero no puede ser denominador de un retorno. */
  | "non_positive_close";

export type TotalReturnSeries =
  | { readonly status: "computed"; readonly returns: readonly DailyReturn[] }
  | {
      readonly status: "unavailable";
      readonly reason: TotalReturnUnavailable;
      readonly marketDate: string;
    };

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new MetricInputError(code, message, subjects),
);

/**
 * Retornos de cada rueda de `closes` salvo la primera, que es la base. Los
 * eventos fuera de `(primera, última]` no participan: los anteriores ya están en
 * la base y los posteriores son el futuro de la ventana.
 */
export function totalReturns(
  closes: readonly ReturnClose[],
  events: readonly ReturnEvent[],
  subjectId: string,
): TotalReturnSeries {
  const ordered = [...closes].sort((left, right) =>
    left.marketDate < right.marketDate ? -1 : 1,
  );

  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.marketDate === ordered[index - 1]!.marketDate) {
      throw new MetricInputError(
        "duplicate_market_date",
        "The series carries two closes for the same market date.",
        [subjectId, ordered[index]!.marketDate],
      );
    }
  }

  const currency = ordered[0]?.currency;

  for (const close of ordered) {
    if (close.currency !== currency) {
      return {
        status: "unavailable",
        reason: "currency_mismatch",
        marketDate: close.marketDate,
      };
    }
  }

  // Un dividendo con ex-date en el día de un split ya está en la base nueva
  // (`price-unadjust-1.1.0`), así que en el mismo día el split va primero.
  const sortedEvents = [...events].sort((left, right) =>
    left.effectiveOn === right.effectiveOn
      ? left.eventType === right.eventType
        ? 0
        : left.eventType === "split"
          ? -1
          : 1
      : left.effectiveOn < right.effectiveOn
        ? -1
        : 1,
  );

  for (const event of sortedEvents) {
    const value = decimal.parseDecimal(
      event.value,
      `events.${event.eventType}.${event.effectiveOn}`,
    );

    if (event.eventType === "split" && (value.isZero() || value.isNeg())) {
      throw new MetricInputError(
        "invalid_split_ratio",
        "A split ratio must be a positive decimal.",
        [subjectId, event.effectiveOn],
      );
    }
  }

  const returns: DailyReturn[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const base = decimal.parseDecimal(
      previous.close,
      `closes.${previous.marketDate}`,
    );

    if (base.isZero()) {
      return {
        status: "unavailable",
        reason: "non_positive_close",
        marketDate: previous.marketDate,
      };
    }

    const inPeriod = sortedEvents.filter(
      (event) =>
        event.effectiveOn > previous.marketDate &&
        event.effectiveOn <= current.marketDate,
    );

    // Acciones que tiene al cierre de `t` quien tenía una al cierre de `t−1`,
    // y cobro de dividendos en la base de su ex-date llevado a esa tenencia.
    let shares: Dec = ONE;
    let dividends: Dec = ZERO;

    for (const event of inPeriod) {
      const value = decimal.parseDecimal(
        event.value,
        `events.${event.eventType}.${event.effectiveOn}`,
      );

      if (event.eventType === "split") {
        shares = decimal.assertFinite(
          shares.times(value),
          `shares.${current.marketDate}`,
        );
        continue;
      }

      if (event.currency !== currency) {
        return {
          status: "unavailable",
          reason: "currency_mismatch",
          marketDate: event.effectiveOn,
        };
      }

      dividends = decimal.assertFinite(
        dividends.plus(value.times(shares)),
        `dividends.${current.marketDate}`,
      );
    }

    const close = decimal.parseDecimal(
      current.close,
      `closes.${current.marketDate}`,
    );
    const ending = decimal.assertFinite(
      close.times(shares).plus(dividends),
      `ending.${current.marketDate}`,
    );

    returns.push({
      marketDate: current.marketDate,
      value: decimal.formatDecimal(
        decimal.divide(ending, base, `return.${current.marketDate}`).minus(ONE),
        `return.${current.marketDate}`,
      ),
    });
  }

  return { status: "computed", returns };
}
