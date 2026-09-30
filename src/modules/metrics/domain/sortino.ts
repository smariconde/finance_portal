import {
  createDecimalOperations,
  sum,
  ZERO,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";
import {
  calendarDaysBetween,
  subtractCalendarYears,
} from "@/modules/temporal/domain/calendar-date";

import { MetricInputError } from "./metric-input-error";
import {
  TOTAL_RETURN_FORMULA_VERSION,
  totalReturns,
  type ReturnClose,
  type ReturnEvent,
  type TotalReturnUnavailable,
} from "./total-return";

/**
 * Ratio de Sortino de una security sobre una ventana que termina en el `as_of`
 * ([ADR 0028](../../../../docs/architecture/adr/0028-sortino-parameters-total-return.md),
 * sobre la especificación de la
 * [ADR 0016](../../../../docs/architecture/adr/0016-analysis-scope-sector-matrices.md) §4).
 *
 * ```text
 * excess_t           = r_t − mar
 * downside_deviation = sqrt( (1/N) · Σ min(0, excess_t)² )   sobre los N períodos
 * sortino            = mean(excess_t) / downside_deviation · sqrt(k)
 * ```
 *
 * Los parámetros los decidió el owner el 2026-09-30 y son parte de la versión:
 * cambiar cualquiera es otra fórmula, no otro argumento.
 *
 * Pura y determinista. No mira el reloj, y todo cierre o evento posterior al
 * `as_of` se ignora: la serie cruda no cambia con un split futuro, así que
 * ignorarlos es exacto y no una aproximación.
 */
export const SORTINO_FORMULA_VERSION = "sortino-1.0.0";

export const SORTINO_PARAMETERS = Object.freeze({
  /** Retorno mínimo aceptable del período: cero, sin fuente de tasa. */
  minimumAcceptableReturn: "0",
  frequency: "daily",
  /** Ruedas por año para anualizar. */
  periodsPerYear: 252,
  returnBasis: TOTAL_RETURN_FORMULA_VERSION,
  /** El numerador es la media aritmética de los excesos, no un CAGR. */
  numerator: "arithmetic_mean",
  /**
   * La ventana va de la misma fecha `n` años antes hasta el `as_of`, y su base
   * es el último cierre en o antes de ese inicio.
   */
  windowBoundary: "calendar",
  /**
   * Mayor distancia en días de calendario entre dos cierres consecutivos que no
   * es un hueco. Un fin de semana largo con feriado son 4; 5 admite además un
   * cierre extraordinario del mercado. Más que eso es `missing_period`, nunca un
   * retorno compuesto sobre una semana que falta.
   */
  maxGapCalendarDays: 5,
} as const);

export const SORTINO_WINDOW_YEARS = [2, 5] as const;

export type SortinoWindowYears = (typeof SORTINO_WINDOW_YEARS)[number];

export type SortinoNullReason =
  /** No hay cierre en o antes del inicio de la ventana: no se la acorta. */
  | "insufficient_history"
  /** No hay cierre en el `as_of`: la ventana no termina donde las demás. */
  | "no_close_at_as_of"
  /** Dos cierres consecutivos más separados que la tolerancia. */
  | "missing_period"
  /** Ningún exceso negativo: el denominador es cero y no hay infinito. */
  | "no_downside_observations"
  | TotalReturnUnavailable;

export type SortinoInput = {
  readonly subjectId: string;
  readonly asOf: string;
  readonly windowYears: SortinoWindowYears;
  readonly closes: readonly ReturnClose[];
  readonly events: readonly ReturnEvent[];
};

type SortinoWindow = {
  readonly windowYears: SortinoWindowYears;
  readonly asOf: string;
  /** `as_of` menos `windowYears` años de calendario. */
  readonly windowStart: string;
};

export type SortinoResult =
  | (SortinoWindow & {
      readonly status: "computed";
      readonly formulaVersion: typeof SORTINO_FORMULA_VERSION;
      readonly value: string;
      /** Cierre que funciona como base del primer retorno. */
      readonly baseDate: string;
      readonly returns: number;
      /** Retornos con exceso negativo: el denominador se apoya en estos. */
      readonly downsideReturns: number;
      readonly meanExcessReturn: string;
      readonly downsideDeviation: string;
    })
  | (SortinoWindow & {
      readonly status: "null";
      readonly formulaVersion: typeof SORTINO_FORMULA_VERSION;
      readonly reason: SortinoNullReason;
      /** Rueda o evento que causó el motivo, cuando hay uno. */
      readonly marketDate: string | null;
    });

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new MetricInputError(code, message, subjects),
);

export function sortino(input: SortinoInput): SortinoResult {
  const window: SortinoWindow = {
    windowYears: input.windowYears,
    asOf: input.asOf,
    windowStart: subtractCalendarYears(input.asOf, input.windowYears),
  };
  const unavailable = (
    reason: SortinoNullReason,
    marketDate: string | null,
  ): SortinoResult => ({
    ...window,
    status: "null",
    formulaVersion: SORTINO_FORMULA_VERSION,
    reason,
    marketDate,
  });

  const known = [...input.closes]
    .filter((close) => close.marketDate <= input.asOf)
    .sort((left, right) => (left.marketDate < right.marketDate ? -1 : 1));

  if (known.at(-1)?.marketDate !== input.asOf) {
    return unavailable("no_close_at_as_of", known.at(-1)?.marketDate ?? null);
  }

  const baseIndex = known.findLastIndex(
    (close) => close.marketDate <= window.windowStart,
  );

  if (baseIndex === -1) {
    return unavailable("insufficient_history", known[0]?.marketDate ?? null);
  }

  const inWindow = known.slice(baseIndex);

  for (let index = 1; index < inWindow.length; index += 1) {
    const gap = calendarDaysBetween(
      inWindow[index - 1]!.marketDate,
      inWindow[index]!.marketDate,
    );

    if (gap > SORTINO_PARAMETERS.maxGapCalendarDays) {
      return unavailable("missing_period", inWindow[index]!.marketDate);
    }
  }

  const series = totalReturns(
    inWindow,
    input.events.filter((event) => event.effectiveOn <= input.asOf),
    input.subjectId,
  );

  if (series.status === "unavailable") {
    return unavailable(series.reason, series.marketDate);
  }

  const mar = decimal.parseDecimal(
    SORTINO_PARAMETERS.minimumAcceptableReturn,
    "parameters.minimumAcceptableReturn",
  );
  const excess = series.returns.map((periodReturn) =>
    decimal
      .parseDecimal(periodReturn.value, `returns.${periodReturn.marketDate}`)
      .minus(mar),
  );
  const periods = decimal.parseDecimal(String(excess.length), "returns.count");
  const downside = excess.filter((value) => value.isNeg());
  const downsideDeviation = decimal.assertFinite(
    decimal
      .divide(
        sum(downside.map((value) => value.times(value))),
        periods,
        "downsideDeviation.variance",
      )
      .sqrt(),
    "downsideDeviation",
  );

  if (downsideDeviation.eq(ZERO)) {
    return unavailable("no_downside_observations", null);
  }

  const meanExcess = decimal.divide(sum(excess), periods, "meanExcessReturn");
  const annualization = decimal
    .parseDecimal(
      String(SORTINO_PARAMETERS.periodsPerYear),
      "parameters.periodsPerYear",
    )
    .sqrt();
  const value = decimal.assertFinite(
    decimal
      .divide(meanExcess, downsideDeviation, "sortino")
      .times(annualization),
    "sortino",
  );

  return {
    ...window,
    status: "computed",
    formulaVersion: SORTINO_FORMULA_VERSION,
    value: decimal.formatDecimal(value, "sortino"),
    baseDate: inWindow[0]!.marketDate,
    returns: excess.length,
    downsideReturns: downside.length,
    meanExcessReturn: decimal.formatDecimal(meanExcess, "meanExcessReturn"),
    downsideDeviation: decimal.formatDecimal(
      downsideDeviation,
      "downsideDeviation",
    ),
  };
}
