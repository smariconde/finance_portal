import {
  createDecimalOperations,
  sum,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";

import {
  selectCalendarWindow,
  type CalendarWindowNullReason,
} from "./calendar-window";
import { MetricInputError } from "./metric-input-error";
import {
  totalReturns,
  type ReturnClose,
  type ReturnEvent,
  type TotalReturnUnavailable,
} from "./total-return";

/**
 * Volatilidad anualizada del precio de una acción (`F4-05`, ADR 0040): el
 * insumo de Black-Scholes para valuar las opciones de empleados.
 *
 * ```text
 * x_t   = ln( P_t × Π ratio(s) / P_{t−1} )      s ∈ (t−1, t]
 * sigma = stdev_muestral(x_t) × sqrt(252)
 * ```
 *
 * Son retornos de **precio**: los splits se llevan a la base, los dividendos
 * no, porque Black-Scholes los recibe aparte como rendimiento. Contarlos en
 * los dos lados los descontaría dos veces. La ventana es la de calendario de
 * la ADR 0028 —cinco años hasta el `as_of`, la base en o antes de su inicio,
 * sin huecos de más de cinco días—, el desvío es muestral (`n − 1`) y la
 * anualización es por 252 ruedas, la misma que Sortino.
 *
 * Pura y determinista: un cierre o un split posterior al `as_of` no entra.
 */
export const EQUITY_VOLATILITY_FORMULA_VERSION = "equity-volatility-1.0.0";

export const EQUITY_VOLATILITY_PARAMETERS = Object.freeze({
  windowYears: 5,
  periodsPerYear: 252,
  returnBasis: "log_price_split_adjusted",
  deviation: "sample",
} as const);

export type EquityVolatilityNullReason =
  | CalendarWindowNullReason
  | TotalReturnUnavailable
  /** Menos de dos retornos: el desvío muestral no existe. */
  | "insufficient_returns";

export type EquityVolatility =
  | {
      readonly status: "computed";
      readonly formulaVersion: typeof EQUITY_VOLATILITY_FORMULA_VERSION;
      readonly asOf: string;
      readonly windowStart: string;
      readonly baseDate: string;
      readonly returns: number;
      /** Desvío diario, antes de anualizar. */
      readonly dailyDeviation: string;
      readonly value: string;
    }
  | {
      readonly status: "null";
      readonly formulaVersion: typeof EQUITY_VOLATILITY_FORMULA_VERSION;
      readonly asOf: string;
      readonly windowStart: string;
      readonly reason: EquityVolatilityNullReason;
      readonly marketDate: string | null;
    };

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new MetricInputError(code, message, subjects),
);

export function equityVolatility(input: {
  readonly subjectId: string;
  readonly asOf: string;
  readonly closes: readonly ReturnClose[];
  readonly events: readonly ReturnEvent[];
}): EquityVolatility {
  const selected = selectCalendarWindow({
    asOf: input.asOf,
    windowYears: EQUITY_VOLATILITY_PARAMETERS.windowYears,
    closes: input.closes,
  });
  const unavailable = (
    reason: EquityVolatilityNullReason,
    marketDate: string | null,
  ): EquityVolatility => ({
    status: "null",
    formulaVersion: EQUITY_VOLATILITY_FORMULA_VERSION,
    asOf: input.asOf,
    windowStart: selected.windowStart,
    reason,
    marketDate,
  });

  if (selected.status === "null") {
    return unavailable(selected.reason, selected.marketDate);
  }

  const series = totalReturns(
    selected.closes,
    // Sólo splits: el dividendo entra a Black-Scholes como rendimiento.
    input.events.filter(
      (event) => event.eventType === "split" && event.effectiveOn <= input.asOf,
    ),
    input.subjectId,
  );

  if (series.status === "unavailable") {
    return unavailable(series.reason, series.marketDate);
  }

  if (series.returns.length < 2) {
    return unavailable("insufficient_returns", null);
  }

  const logs = series.returns.map((periodReturn) =>
    decimal
      .parseDecimal(periodReturn.value, `returns.${periodReturn.marketDate}`)
      .plus(1)
      .ln(),
  );
  const count = decimal.parseDecimal(String(logs.length), "returns.count");
  const mean = decimal.divide(sum(logs), count, "volatility.mean");
  const squares = sum(
    logs.map((value) => value.minus(mean).times(value.minus(mean))),
  );
  const dailyDeviation = decimal.assertFinite(
    decimal.divide(squares, count.minus(1), "volatility.variance").sqrt(),
    "volatility.dailyDeviation",
  );
  const value = decimal.assertFinite(
    dailyDeviation.times(
      decimal
        .parseDecimal(
          String(EQUITY_VOLATILITY_PARAMETERS.periodsPerYear),
          "parameters.periodsPerYear",
        )
        .sqrt(),
    ),
    "volatility",
  );

  return {
    status: "computed",
    formulaVersion: EQUITY_VOLATILITY_FORMULA_VERSION,
    asOf: input.asOf,
    windowStart: selected.windowStart,
    baseDate: selected.closes[0]!.marketDate,
    returns: logs.length,
    dailyDeviation: decimal.formatDecimal(
      dailyDeviation,
      "volatility.dailyDeviation",
    ),
    value: decimal.formatDecimal(value, "volatility"),
  };
}
