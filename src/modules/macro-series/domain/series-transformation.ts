import {
  createDecimalOperations,
  HUNDRED,
  ONE,
  ZERO,
  type Dec,
  type DecimalErrorCode,
} from "@/modules/numeric/domain/decimal-policy";

import type { BcraVariableId } from "./bcra-monetary-source";
import {
  caveatsFor,
  type TransformationCaveat,
} from "./declared-transformation-caveats";
import { sameBasis, type SeriesBasis } from "./series-definition";
import type { SeriesPoint } from "./series-observation";

/**
 * Transformaciones de una serie monetaria en pesos (`F9-02`, ADR 0066): a pesos
 * constantes por el IPC encadenado o por el CER, y a dólares por el mayorista.
 *
 * Son lecturas, nunca datos: se calculan al leer, sobre lo que el corte deja
 * ver de cada serie, y no se guardan. La serie nominal sigue siendo el único
 * hecho, y cada punto transformado lleva el nominal y la fecha de la
 * referencia que lo transformó.
 *
 * ```text
 * real_cpi(m)      = nominal(m) × I(base) / I(m)      I(m) = Π (1 + π_k / 100), k ≤ m
 * real_cer(t)      = nominal(t) × CER(base) / CER(t)
 * usd_wholesale(t) = nominal(t) / mayorista(t)
 * ```
 *
 * `nominal(m)` es el último punto de la serie dentro del mes `m`: un stock a
 * fin de mes, que es lo que el IPC de ese mes deflacta. El CER y el mayorista
 * se exigen **el mismo día**; un día sin referencia es `null` con motivo y
 * nunca toma el valor de otro día.
 */
export const MACRO_TRANSFORM_VERSION = "macro-transform-1.0.0";
export const CPI_CHAIN_VERSION = "bcra-cpi-chain-1.0.0";

export const TRANSFORMATION_KINDS = [
  "real_cpi",
  "real_cer",
  "usd_wholesale",
] as const;

export type TransformationKind = (typeof TRANSFORMATION_KINDS)[number];

/** La serie del BCRA que cada transformación usa como referencia. */
export const TRANSFORMATION_REFERENCES: Readonly<
  Record<TransformationKind, BcraVariableId>
> = Object.freeze({
  /** Inflación mensual: variación del IPC del INDEC, en porcentaje. */
  real_cpi: 27,
  /** Coeficiente de estabilización de referencia, base 2.2.02 = 1. */
  real_cer: 30,
  /** Tipo de cambio mayorista de referencia (Comunicación A 3500). */
  usd_wholesale: 5,
});

/**
 * La base que cada referencia tenía cuando se fijó esta versión. Una referencia
 * con otra base se rechaza por nombre: deflactar por una inflación que pasó a
 * otra unidad daría un número plausible y falso.
 */
export const TRANSFORMATION_REFERENCE_BASES: Readonly<
  Record<TransformationKind, SeriesBasis>
> = Object.freeze({
  real_cpi: { frequency: "monthly", unit: "En porcentaje", currencyCode: "ML" },
  real_cer: {
    frequency: "daily",
    unit: "Índice base 2.2.02=1",
    currencyCode: "ML",
  },
  usd_wholesale: {
    frequency: "daily",
    unit: "Pesos argentinos por dólar estadounidense",
    currencyCode: "ML",
  },
});

/** La única unidad que se transforma: un monto en millones de pesos. */
export const PESO_AMOUNT_UNIT = "En millones de ARS";

export type NotTransformableReason =
  /** Tasas, índices, porcentajes, tipos de cambio o montos en dólares. */
  | "not_peso_amount"
  /**
   * Incluye moneda extranjera valuada en pesos (`MEyML`): deflactarla haría
   * pasar una devaluación por crecimiento real. Sólo admite dólares (owner).
   */
  | "includes_foreign_currency";

/**
 * Qué transformaciones admite una serie, decidido sobre su base fijada. La base
 * no cambia sin que el registro rechace la serie (ADR 0065), así que la regla
 * por unidad no se mueve sola.
 */
export function transformationEligibility(
  basis: SeriesBasis,
  kind: TransformationKind,
): NotTransformableReason | null {
  if (basis.unit !== PESO_AMOUNT_UNIT) {
    return "not_peso_amount";
  }

  if (basis.currencyCode === "ML") {
    return null;
  }

  return basis.currencyCode === "MEyML" && kind === "usd_wholesale"
    ? null
    : "includes_foreign_currency";
}

export type PointUnavailableReason =
  /** La fecha es anterior al primer dato de la referencia. */
  | "before_reference_history"
  /** La referencia todavía no publicó ese mes o ese día al corte. */
  | "reference_not_published"
  /** Hay referencia antes y después, pero no ese día o ese tramo. */
  | "reference_gap";

export type TransformedPoint = {
  /** Fecha del punto nominal que se transformó. */
  readonly periodOn: string;
  readonly nominal: string;
  /** Decimal canónico, o `null` con `reason`. */
  readonly value: string | null;
  readonly reason: PointUnavailableReason | null;
  /** Mes (`YYYY-MM`) o día de la referencia aplicada; `null` sin referencia. */
  readonly referenceOn: string | null;
};

export type TransformationResult =
  | {
      readonly status: "computed";
      readonly kind: TransformationKind;
      readonly version: typeof MACRO_TRANSFORM_VERSION;
      /** `bcra-cpi-chain-1.0.0` sólo para `real_cpi`. */
      readonly chainVersion: typeof CPI_CHAIN_VERSION | null;
      readonly unit: string;
      /** Mes o día cuyos pesos son la unidad; `null` para dólares. */
      readonly baseOn: string | null;
      readonly points: readonly TransformedPoint[];
      /** Fechas propias de cada serie que entró: nunca una fecha común inventada. */
      readonly coverage: {
        readonly nominal: SeriesSpan | null;
        readonly reference: SeriesSpan | null;
      };
      readonly caveats: readonly TransformationCaveat[];
    }
  | {
      readonly status: "not_transformable";
      readonly kind: TransformationKind;
      readonly reason: NotTransformableReason;
    }
  | {
      /** La base pedida no tiene referencia al corte. */
      readonly status: "base_not_available";
      readonly kind: TransformationKind;
      readonly baseOn: string;
    }
  | {
      /** La referencia cambió de base respecto de la que esta versión fijó. */
      readonly status: "reference_basis_unexpected";
      readonly kind: TransformationKind;
      readonly referenceBasis: SeriesBasis;
    }
  | {
      /** La referencia no tiene ningún punto visible al corte. */
      readonly status: "reference_empty";
      readonly kind: TransformationKind;
    };

export type SeriesSpan = { readonly firstOn: string; readonly lastOn: string };

export type TransformationInput = {
  readonly kind: TransformationKind;
  readonly basis: SeriesBasis;
  readonly referenceBasis: SeriesBasis;
  readonly nominal: readonly SeriesPoint[];
  readonly reference: readonly SeriesPoint[];
  /**
   * Mes (`YYYY-MM`) para `real_cpi` o día para `real_cer` cuyos pesos son la
   * unidad. Sin él, el último que la referencia tiene al corte.
   */
  readonly baseOn?: string;
};

export type MacroTransformErrorCode =
  DecimalErrorCode | "non_positive_reference" | "invalid_base";

/**
 * Una referencia que viola el contrato: un CER o un mayorista en cero o
 * negativo, o una inflación de −100 % o menos. No es un dato faltante; es una
 * serie que no debería haber llegado así.
 */
export class MacroTransformError extends Error {
  readonly code: MacroTransformErrorCode;
  readonly subjects: readonly string[];

  constructor(
    code: MacroTransformErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "MacroTransformError";
    this.code = code;
    this.subjects = subjects;
  }
}

const decimal = createDecimalOperations(
  (code: DecimalErrorCode, message, subjects) =>
    new MacroTransformError(code, message, subjects),
);

export function transformSeries(
  input: TransformationInput,
): TransformationResult {
  const { kind } = input;
  const ineligible = transformationEligibility(input.basis, kind);

  if (ineligible !== null) {
    return { status: "not_transformable", kind, reason: ineligible };
  }

  if (!sameBasis(input.referenceBasis, TRANSFORMATION_REFERENCE_BASES[kind])) {
    return {
      status: "reference_basis_unexpected",
      kind,
      referenceBasis: input.referenceBasis,
    };
  }

  if (input.reference.length === 0) {
    return { status: "reference_empty", kind };
  }

  return kind === "real_cpi"
    ? transformByCpi(input)
    : transformByDailyReference(input);
}

export type CpiIndexMonth = {
  readonly month: string;
  readonly index: Dec;
  /** Tramo de meses consecutivos: dos tramos no se comparan. */
  readonly segment: number;
};

/**
 * `bcra-cpi-chain-1.0.0`: un índice de precios encadenando la inflación
 * mensual publicada. El nivel es arbitrario —sólo se usan cocientes—, y un mes
 * que falta abre un tramo nuevo en vez de interpolarse.
 */
export function chainCpiIndex(
  monthlyInflation: readonly SeriesPoint[],
): readonly CpiIndexMonth[] {
  const months: CpiIndexMonth[] = [];
  let level = ONE;
  let segment = 0;
  let previous: string | null = null;

  for (const point of monthlyInflation) {
    const month = point.periodOn.slice(0, 7);

    if (previous !== null && month === previous) {
      throw new MacroTransformError(
        "invalid_base",
        "Monthly inflation carries two points in the same month.",
        [point.periodOn],
      );
    }

    if (previous !== null && month !== nextMonth(previous)) {
      segment += 1;
      level = ONE;
    }

    const factor = ONE.plus(
      decimal.divide(
        decimal.parseDecimal(point.value, point.periodOn),
        HUNDRED,
        point.periodOn,
      ),
    );

    if (!factor.greaterThan(ZERO)) {
      throw new MacroTransformError(
        "non_positive_reference",
        "Monthly inflation of -100 % or less cannot be chained.",
        [point.periodOn],
      );
    }

    level = decimal.assertFinite(level.times(factor), point.periodOn);
    months.push({ month, index: level, segment });
    previous = month;
  }

  return months;
}

function transformByCpi(input: TransformationInput): TransformationResult {
  const chain = chainCpiIndex(input.reference);
  const byMonth = new Map(chain.map((entry) => [entry.month, entry]));
  const baseMonth = input.baseOn ?? chain.at(-1)!.month;

  if (!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(baseMonth)) {
    throw new MacroTransformError(
      "invalid_base",
      "A CPI base must be a month (YYYY-MM).",
      [baseMonth],
    );
  }

  const base = byMonth.get(baseMonth);

  if (base === undefined) {
    return {
      status: "base_not_available",
      kind: "real_cpi",
      baseOn: baseMonth,
    };
  }

  const firstMonth = chain[0]!.month;
  const lastMonth = chain.at(-1)!.month;
  const points: TransformedPoint[] = [];

  for (const point of lastPointOfEachMonth(input.nominal)) {
    const month = point.periodOn.slice(0, 7);
    const entry = byMonth.get(month);

    if (entry === undefined || entry.segment !== base.segment) {
      points.push(
        unavailable(
          point,
          month < firstMonth
            ? "before_reference_history"
            : month > lastMonth
              ? "reference_not_published"
              : "reference_gap",
        ),
      );
      continue;
    }

    points.push({
      periodOn: point.periodOn,
      nominal: point.value,
      value: decimal.formatDecimal(
        decimal.divide(
          decimal.parseDecimal(point.value, point.periodOn).times(base.index),
          entry.index,
          point.periodOn,
        ),
        point.periodOn,
      ),
      reason: null,
      referenceOn: month,
    });
  }

  return computed(input, points, CPI_CHAIN_VERSION, baseMonth, {
    firstOn: firstMonth,
    lastOn: lastMonth,
  });
}

function transformByDailyReference(
  input: TransformationInput,
): TransformationResult {
  const kind = input.kind;
  const byDate = new Map<string, Dec>();

  for (const point of input.reference) {
    const value = decimal.parseDecimal(point.value, point.periodOn);

    if (!value.greaterThan(ZERO)) {
      throw new MacroTransformError(
        "non_positive_reference",
        "A CER or a wholesale rate must be strictly positive.",
        [point.periodOn],
      );
    }

    byDate.set(point.periodOn, value);
  }

  const firstOn = input.reference[0]!.periodOn;
  const lastOn = input.reference.at(-1)!.periodOn;
  let baseOn: string | null = null;
  let base: Dec | null = null;

  if (kind === "real_cer") {
    baseOn = input.baseOn ?? lastOn;

    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(baseOn)) {
      throw new MacroTransformError(
        "invalid_base",
        "A CER base must be a day (YYYY-MM-DD).",
        [baseOn],
      );
    }

    base = byDate.get(baseOn) ?? null;

    if (base === null) {
      return { status: "base_not_available", kind, baseOn };
    }
  }

  const points: TransformedPoint[] = input.nominal.map((point) => {
    const reference = byDate.get(point.periodOn);

    if (reference === undefined) {
      return unavailable(
        point,
        point.periodOn < firstOn
          ? "before_reference_history"
          : point.periodOn > lastOn
            ? "reference_not_published"
            : "reference_gap",
      );
    }

    const nominal = decimal.parseDecimal(point.value, point.periodOn);
    const value =
      base === null
        ? decimal.divide(nominal, reference, point.periodOn)
        : decimal.divide(nominal.times(base), reference, point.periodOn);

    return {
      periodOn: point.periodOn,
      nominal: point.value,
      value: decimal.formatDecimal(value, point.periodOn),
      reason: null,
      referenceOn: point.periodOn,
    };
  });

  return computed(input, points, null, baseOn, { firstOn, lastOn });
}

function computed(
  input: TransformationInput,
  points: readonly TransformedPoint[],
  chainVersion: typeof CPI_CHAIN_VERSION | null,
  baseOn: string | null,
  reference: SeriesSpan,
): TransformationResult {
  const nominal =
    input.nominal.length === 0
      ? null
      : {
          firstOn: input.nominal[0]!.periodOn,
          lastOn: input.nominal.at(-1)!.periodOn,
        };

  return {
    status: "computed",
    kind: input.kind,
    version: MACRO_TRANSFORM_VERSION,
    chainVersion,
    unit:
      input.kind === "usd_wholesale"
        ? "En millones de USD"
        : `En millones de ARS de ${baseOn}`,
    baseOn,
    points,
    coverage: { nominal, reference },
    caveats:
      nominal === null
        ? []
        : caveatsFor(input.kind, nominal.firstOn, nominal.lastOn),
  };
}

function unavailable(
  point: SeriesPoint,
  reason: PointUnavailableReason,
): TransformedPoint {
  return {
    periodOn: point.periodOn,
    nominal: point.value,
    value: null,
    reason,
    referenceOn: null,
  };
}

/** Puntos ordenados por fecha: el último de cada mes es el stock a fin de mes. */
function lastPointOfEachMonth(
  points: readonly SeriesPoint[],
): readonly SeriesPoint[] {
  const byMonth = new Map<string, SeriesPoint>();

  for (const point of points) {
    byMonth.set(point.periodOn.slice(0, 7), point);
  }

  return [...byMonth.values()];
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const value = Number(month.slice(5, 7));

  return value === 12
    ? `${year + 1}-01`
    : `${year}-${String(value + 1).padStart(2, "0")}`;
}

export const CPI_CHAIN_RECONCILIATION_VERSION =
  "cpi-chain-reconciliation-1.0.0";

/**
 * Desvío admitido entre el interanual que da la cadena y el publicado, como
 * fracción del nivel: `|(1 + π_cadena) − (1 + π_publicado)| / (1 + π_publicado)`.
 * Medido sobre 992 meses del BCRA: mediana 0,07 %, máximo 0,43 %, que es el
 * redondeo a un decimal acumulado en doce meses (ADR 0066).
 */
export const CPI_CHAIN_TOLERANCE = "0.005";

export type CpiChainReconciliation = {
  readonly version: typeof CPI_CHAIN_RECONCILIATION_VERSION;
  readonly compared: number;
  /** Desvío máximo como fracción del nivel, en decimal canónico. */
  readonly maxDeviation: string | null;
  /** Meses fuera de la tolerancia: una cadena que no reproduce lo publicado. */
  readonly outside: readonly {
    readonly month: string;
    readonly deviation: string;
  }[];
};

/**
 * Concilia la cadena con la inflación interanual que publica la misma fuente
 * (variable 28): doce meses encadenados tienen que dar el interanual. Sólo se
 * comparan meses cuyos dos extremos están en el mismo tramo.
 */
export function reconcileCpiChain(
  monthlyInflation: readonly SeriesPoint[],
  yearOnYear: readonly SeriesPoint[],
): CpiChainReconciliation {
  const byMonth = new Map(
    chainCpiIndex(monthlyInflation).map((entry) => [entry.month, entry]),
  );
  const tolerance = decimal.parseDecimal(CPI_CHAIN_TOLERANCE, "tolerance");
  const outside: { month: string; deviation: string }[] = [];
  let compared = 0;
  let max: Dec | null = null;

  for (const point of yearOnYear) {
    const month = point.periodOn.slice(0, 7);
    const prior = `${String(Number(month.slice(0, 4)) - 1)}${month.slice(4)}`;
    const end = byMonth.get(month);
    const start = byMonth.get(prior);

    if (
      end === undefined ||
      start === undefined ||
      end.segment !== start.segment
    ) {
      continue;
    }

    const published = ONE.plus(
      decimal.divide(
        decimal.parseDecimal(point.value, point.periodOn),
        HUNDRED,
        point.periodOn,
      ),
    );
    const chained = decimal.divide(end.index, start.index, point.periodOn);
    const deviation = decimal.divide(
      chained.minus(published).abs(),
      published,
      point.periodOn,
    );

    compared += 1;
    max = max === null || deviation.greaterThan(max) ? deviation : max;

    if (deviation.greaterThan(tolerance)) {
      outside.push({
        month,
        deviation: decimal.formatDecimal(deviation, point.periodOn),
      });
    }
  }

  return {
    version: CPI_CHAIN_RECONCILIATION_VERSION,
    compared,
    maxDeviation: max === null ? null : decimal.formatDecimal(max, "max"),
    outside,
  };
}
