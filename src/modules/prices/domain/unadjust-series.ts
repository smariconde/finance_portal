import {
  createDecimalOperations,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";

/**
 * Des-ajuste de una serie de precios
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md),
 * decisión 3).
 *
 * La fuente publica la serie **ajustada por todos los splits que ocurrieron
 * después de cada rueda**, y la reescribe hacia atrás cada vez que hay uno
 * nuevo. Este módulo la devuelve a lo que efectivamente se operó:
 *
 * ```text
 * raw(t) = close(t) × Π  ratio(s)
 *                   s: fecha(s) > t
 * ```
 *
 * Verificado sobre NVDA el 2026-09-22: el cierre del 2024-06-05 vuelve a ser
 * 1.224,40 desde los 122,44 que la fuente devuelve, aplicando el 10:1 del
 * 2024-06-10.
 *
 * `1.1.0` (`F7-04`) extiende la regla a los **dividendos**, que la fuente
 * también divide por los splits posteriores: NVDA pagó US$ 0,04 el 2024-03-05 y
 * la `1.0.0` lo guardó como 0,004 al lado de un cierre crudo de 859,64. Un
 * dividendo y el cierre de su rueda tienen que estar en la misma base, o la
 * total return subestima el rendimiento anterior a cada split.
 *
 * Es puro y determinista: recibe la serie y los eventos, y no mira el reloj.
 */
export const PRICE_UNADJUST_RULE_VERSION = "price-unadjust-1.1.0";

export type UnadjustErrorCode =
  | DecimalErrorCode
  /** Un ratio que no es un decimal positivo no puede multiplicar nada. */
  | "invalid_split_ratio"
  /** La serie trae una fecha repetida: dos cierres para una misma rueda. */
  | "duplicate_market_date";

export class PriceUnadjustError extends Error {
  readonly code: UnadjustErrorCode;
  readonly subjects: readonly string[];

  constructor(
    code: UnadjustErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "PriceUnadjustError";
    this.code = code;
    this.subjects = subjects;
  }
}

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new PriceUnadjustError(code, message, subjects),
);

export type AdjustedBar = {
  /** Fecha de mercado en ISO (`YYYY-MM-DD`). */
  readonly marketDate: string;
  /** Cierre tal como lo publica la fuente, ya ajustado por ella. */
  readonly close: string;
};

export type SplitEvent = {
  readonly effectiveOn: string;
  /** Ratio como decimal: `10` en un 10:1, `0.125` en un 1:8. */
  readonly ratio: string;
};

export type UnadjustedBar = {
  readonly marketDate: string;
  /** Cierre crudo: lo que se operó ese día. */
  readonly close: string;
  /**
   * Factor aplicado. Se devuelve para que la corrida pueda decir **por qué** una
   * fila difiere de lo que la fuente publica hoy; `1` es "la fuente ya la daba
   * cruda", que es el caso de toda rueda posterior al último split.
   */
  readonly appliedFactor: string;
};

export type AdjustedDividend = {
  readonly effectiveOn: string;
  /** Importe por acción tal como lo publica la fuente, ya ajustado por ella. */
  readonly amount: string;
};

export type UnadjustedDividend = {
  readonly effectiveOn: string;
  /** Importe por acción en la base de la rueda de su ex-date. */
  readonly amount: string;
  readonly appliedFactor: string;
};

function orderedSplits(
  splits: readonly SplitEvent[],
  subjectId: string,
): readonly SplitEvent[] {
  const ordered = [...splits].sort((left, right) =>
    left.effectiveOn < right.effectiveOn ? -1 : 1,
  );

  for (const split of ordered) {
    const ratio = decimal.parseDecimal(
      split.ratio,
      `splits.${split.effectiveOn}.ratio`,
    );

    if (!ratio.isPositive() || ratio.isZero()) {
      throw new PriceUnadjustError(
        "invalid_split_ratio",
        "A split ratio must be a positive decimal.",
        [subjectId, split.effectiveOn],
      );
    }
  }

  return ordered;
}

/**
 * El escalar de una fecha es el producto de los ratios de los splits
 * **estrictamente posteriores**: un split con fecha efectiva igual a la rueda ya
 * está reflejado en el precio de esa rueda, porque la acción abrió ese día en la
 * base nueva. Lo mismo vale para un dividendo con ex-date en el día del split.
 */
function factorAfter(ordered: readonly SplitEvent[], date: string) {
  let factor = decimal.parseDecimal("1", "factor");

  for (const split of ordered) {
    if (split.effectiveOn > date) {
      factor = decimal.assertFinite(
        factor.times(
          decimal.parseDecimal(
            split.ratio,
            `splits.${split.effectiveOn}.ratio`,
          ),
        ),
        `factor.${date}`,
      );
    }
  }

  return factor;
}

/** Des-ajusta la serie de cierres. */
export function unadjustSeries(
  bars: readonly AdjustedBar[],
  splits: readonly SplitEvent[],
  subjectId: string,
): readonly UnadjustedBar[] {
  const seen = new Set<string>();

  for (const bar of bars) {
    if (seen.has(bar.marketDate)) {
      throw new PriceUnadjustError(
        "duplicate_market_date",
        "The series carries two closes for the same market date.",
        [subjectId, bar.marketDate],
      );
    }

    seen.add(bar.marketDate);
  }

  const ordered = orderedSplits(splits, subjectId);

  return bars.map((bar) => {
    const factor = factorAfter(ordered, bar.marketDate);
    const close = decimal.parseDecimal(bar.close, `bars.${bar.marketDate}`);

    return {
      marketDate: bar.marketDate,
      close: decimal.formatDecimal(
        decimal.assertFinite(close.times(factor), `raw.${bar.marketDate}`),
        `raw.${bar.marketDate}`,
      ),
      appliedFactor: decimal.formatDecimal(factor, `factor.${bar.marketDate}`),
    };
  });
}

/**
 * Des-ajusta los dividendos con el mismo factor que los cierres
 * (`price-unadjust-1.1.0`): el importe vuelve a ser el que se pagó por acción
 * en la base de su ex-date, y la fila deja de cambiar con cada split futuro.
 */
export function unadjustDividends(
  dividends: readonly AdjustedDividend[],
  splits: readonly SplitEvent[],
  subjectId: string,
): readonly UnadjustedDividend[] {
  const ordered = orderedSplits(splits, subjectId);

  return dividends.map((dividend) => {
    const factor = factorAfter(ordered, dividend.effectiveOn);
    const amount = decimal.parseDecimal(
      dividend.amount,
      `dividends.${dividend.effectiveOn}`,
    );

    return {
      effectiveOn: dividend.effectiveOn,
      amount: decimal.formatDecimal(
        decimal.assertFinite(
          amount.times(factor),
          `dividends.${dividend.effectiveOn}.raw`,
        ),
        `dividends.${dividend.effectiveOn}.raw`,
      ),
      appliedFactor: decimal.formatDecimal(
        factor,
        `factor.${dividend.effectiveOn}`,
      ),
    };
  });
}
