import {
  createDecimalOperations,
  type Dec,
  type DecimalErrorCode,
  ZERO,
} from "@/modules/numeric/domain/decimal-policy";

import {
  legIdOf,
  ratioOn,
  type AdrLegClose,
  type DeclaredAdrPair,
} from "./declared-adr-pairs";

/**
 * CCL implícito diario (`ccl-implied-1.0.0`, ADR 0068):
 *
 * ```text
 * ccl_p(t) = local_p(t) × ratio_p(t) / adr_p(t)        pesos por dólar
 * CCL(t)   = mediana { ccl_p(t) : p con las dos patas cerradas el día t }
 * ```
 *
 * Las dos patas tienen que cerrar **el mismo día**: un día con feriado en uno
 * de los dos mercados deja fuera al par, nunca toma el cierre de otro día. La
 * mediana amortigua un par con un cierre raro —medido: Galicia sola daba +206 %
 * en agosto de 2002—, y con menos de tres pares el día es `null` con motivo,
 * porque la mediana de dos es un promedio y la de uno es ese par.
 */
export const IMPLIED_CCL_VERSION = "ccl-implied-1.0.0";
export const MIN_PAIRS_PER_DAY = 3;

export type ImpliedCclPoint = {
  readonly marketDate: string;
  /** Pesos por dólar, decimal canónico; `null` con `reason`. */
  readonly value: string | null;
  readonly reason: "insufficient_pairs" | null;
  /** Pares que entraron ese día, por id. */
  readonly pairs: readonly string[];
  /** El menor y el mayor de los implícitos del día: la dispersión entre pares. */
  readonly low: string | null;
  readonly high: string | null;
};

export class ImpliedCclError extends Error {
  readonly code: DecimalErrorCode | "non_positive_close";
  readonly subjects: readonly string[];

  constructor(
    code: DecimalErrorCode | "non_positive_close",
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "ImpliedCclError";
    this.code = code;
    this.subjects = subjects;
  }
}

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new ImpliedCclError(code, message, subjects),
);

/**
 * El CCL de cada día en que al menos un par cotizó de los dos lados, en orden.
 * Recibe los cierres ya filtrados al corte.
 */
export function computeImpliedCcl(
  pairs: readonly DeclaredAdrPair[],
  closes: readonly AdrLegClose[],
): readonly ImpliedCclPoint[] {
  const byLeg = new Map<string, Map<string, Dec>>();

  for (const close of closes) {
    const value = decimal.parseDecimal(close.close, close.legId);

    if (!value.greaterThan(ZERO)) {
      throw new ImpliedCclError(
        "non_positive_close",
        "A leg close must be strictly positive.",
        [close.legId, close.marketDate],
      );
    }

    const leg = byLeg.get(close.legId) ?? new Map<string, Dec>();
    leg.set(close.marketDate, value);
    byLeg.set(close.legId, leg);
  }

  const byDate = new Map<string, { pairId: string; value: Dec }[]>();

  for (const pair of pairs) {
    const adr = byLeg.get(legIdOf(pair.pairId, "adr"));
    const local = byLeg.get(legIdOf(pair.pairId, "local"));

    if (adr === undefined || local === undefined) {
      continue;
    }

    for (const [marketDate, adrClose] of adr) {
      const localClose = local.get(marketDate);
      const ratio = ratioOn(pair, marketDate);

      if (localClose === undefined || ratio === null) {
        continue;
      }

      const implied = decimal.divide(
        localClose.times(decimal.parseDecimal(ratio, pair.pairId)),
        adrClose,
        `${pair.pairId}:${marketDate}`,
      );
      const day = byDate.get(marketDate) ?? [];
      day.push({ pairId: pair.pairId, value: implied });
      byDate.set(marketDate, day);
    }
  }

  return [...byDate.keys()].sort().map((marketDate) => {
    const day = byDate
      .get(marketDate)!
      .sort((left, right) => left.value.comparedTo(right.value));
    const ids = day.map((entry) => entry.pairId).sort();
    const low = decimal.formatDecimal(day[0]!.value, marketDate);
    const high = decimal.formatDecimal(day.at(-1)!.value, marketDate);

    if (day.length < MIN_PAIRS_PER_DAY) {
      return {
        marketDate,
        value: null,
        reason: "insufficient_pairs",
        pairs: ids,
        low,
        high,
      };
    }

    const middle = Math.floor(day.length / 2);
    const median =
      day.length % 2 === 1
        ? day[middle]!.value
        : decimal.divide(
            day[middle - 1]!.value.plus(day[middle]!.value),
            decimal.parseDecimal("2", marketDate),
            marketDate,
          );

    return {
      marketDate,
      value: decimal.formatDecimal(median, marketDate),
      reason: null,
      pairs: ids,
      low,
      high,
    };
  });
}

export const FX_GAP_VERSION = "fx-gap-1.0.0";

export type FxGapPoint = {
  readonly marketDate: string;
  /** `CCL / oficial − 1`, decimal canónico: `0.75` es una brecha del 75 %. */
  readonly gap: string;
};

/** La brecha de cada día en que las dos series publicaron, nunca entre días. */
export function computeFxGap(
  ccl: readonly { readonly periodOn: string; readonly value: string }[],
  official: readonly { readonly periodOn: string; readonly value: string }[],
): readonly FxGapPoint[] {
  const officialByDate = new Map(
    official.map((point) => [point.periodOn, point.value]),
  );
  const gaps: FxGapPoint[] = [];

  for (const point of ccl) {
    const reference = officialByDate.get(point.periodOn);

    if (reference === undefined) {
      continue;
    }

    const gap = decimal
      .divide(
        decimal.parseDecimal(point.value, point.periodOn),
        decimal.parseDecimal(reference, point.periodOn),
        point.periodOn,
      )
      .minus(1);

    gaps.push({
      marketDate: point.periodOn,
      gap: decimal.formatDecimal(gap, point.periodOn),
    });
  }

  return gaps;
}
