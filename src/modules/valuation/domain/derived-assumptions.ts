import { z } from "zod";

import {
  calendarDaysBetween,
  subtractCalendarYears,
} from "@/modules/temporal/domain/calendar-date";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { marginalTaxRateOf, type CostOfCapital } from "./cost-of-capital";
import {
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import type { Normalization } from "./normalization";
import {
  SCENARIO_SET_VERSION,
  type Scenario,
  type ScenarioDriver,
  type ScenarioSet,
} from "./scenarios";
import type {
  PeriodAssumption,
  SensitivitySpec,
  TerminalAssumption,
} from "./valuation-input";

/**
 * Supuestos derivados de lo guardado (`F6-07`,
 * [ADR 0046](../../../../docs/architecture/adr/0046-derived-valuation-assumptions.md)).
 *
 * Una regla, no una opinión: el crecimiento sale del revenue reportado, el
 * margen y la reinversión del año base normalizado, el WACC y la libre de
 * riesgo del costo de capital fechado. Diez años explícitos; los cinco
 * primeros sostienen el punto de partida y los cinco siguientes convergen en
 * línea recta al terminal, que crece a la libre de riesgo con un retorno sobre
 * el capital igual a su WACC (sin retornos en exceso a perpetuidad).
 *
 * El snapshot congela sólo lo que no está ya en él —la historia de revenue—,
 * y un policy check reconstruye períodos, terminal y sensibilidad desde ahí.
 *
 * `2.0.0` (`F6-10`,
 * [ADR 0049](../../../../docs/architecture/adr/0049-derived-assumptions-v2.md))
 * cambia tres cosas y congela lo que necesita para reconstruirlas:
 *
 * - el crecimiento inicial es la **tendencia log-lineal** de la historia, no
 *   el CAGR entre sus puntas, que depende del año en que empieza la ventana;
 * - el ROIC terminal sale de `terminal-return-on-capital-1.0.0`: el menor
 *   entre el ROC de la industria (Damodaran) y el ROIC ajustado de la propia
 *   empresa, nunca por debajo del WACC terminal;
 * - bear y bull se derivan de lo medido: el crecimiento más bajo y más alto
 *   entre las ventanas, y el ROIC terminal en el WACC (sin ventaja) o en el
 *   propio de la empresa (ventaja intacta).
 *
 * `1.0.0` sigue leyéndose igual: sus corridas conservan hashes y replay.
 *
 * `3.0.0` (`F6-39`,
 * [ADR 0085](../../../../docs/architecture/adr/0085-consensus-near-term-growth.md))
 * toma los años 1 y 2 del nivel de ventas del consenso de analistas
 * (`consensus-revenue-path-1.0.0`) y bear y bull de su mínimo y su máximo;
 * desde el año 3 es `2.0.0`. Sin un consenso que sirva, es `2.0.0` en todo y
 * nombra por qué.
 */
export const DERIVED_ASSUMPTIONS_VERSION = "derived-assumptions-1.0.0";
export const DERIVED_ASSUMPTIONS_V2_VERSION = "derived-assumptions-2.0.0";
export const DERIVED_ASSUMPTIONS_V3_VERSION = "derived-assumptions-3.0.0";
export const CONSENSUS_REVENUE_PATH_VERSION = "consensus-revenue-path-1.0.0";
export const CONSENSUS_REVENUE_SOURCE_ID = "alpha-vantage";
export const CONSENSUS_REVENUE_DATASET = "alpha-vantage.earnings-estimates";
/** La fuente publica en dólares. */
export const CONSENSUS_REVENUE_CURRENCY = "USD";
/** Captura y `as_of` a no más de esto, como el forward P/E. */
export const CONSENSUS_REVENUE_STALE_AFTER_DAYS = 7;
/** FY1 es el ejercicio siguiente a FY0, y FY2 el siguiente a FY1. */
const CONSENSUS_MIN_YEAR_DAYS = 350;
const CONSENSUS_MAX_YEAR_DAYS = 380;
/** Años explícitos que vienen del consenso. */
export const CONSENSUS_REVENUE_YEARS = 2;
export const TERMINAL_RETURN_RULE_VERSION = "terminal-return-on-capital-1.0.0";
/** ROC después de impuestos por industria, de la página EVA de Damodaran. */
export const INDUSTRY_RETURNS_DATASET = "damodaran.eva-us";
export const INDUSTRY_RETURN_FIELD = "roc";
/**
 * `F6-31`: la ventas sobre capital de la industria, la que usa Damodaran cuando
 * la propia no sirve —capital invertido ajustado no positivo porque la caja
 * supera al patrimonio más la deuda, como PLTR o DDOG—.
 */
export const INDUSTRY_CAPITAL_DATASET = "damodaran.capex-us";
export const INDUSTRY_SALES_TO_CAPITAL_FIELD = "sales_to_invested_capital";
export const SALES_TO_CAPITAL_RULE_VERSION = "industry-sales-to-capital-1.0.0";

export const DERIVED_EXPLICIT_YEARS = 10;
/** Último año que sostiene el punto de partida; desde el siguiente converge. */
export const DERIVED_HOLD_YEARS = 5;
/** Ejercicios consecutivos como máximo: cinco tasas de crecimiento. */
export const DERIVED_MAX_REVENUE_YEARS = 6;
/** Dos tasas como mínimo: una sola es un año, no una tendencia. */
export const DERIVED_MIN_REVENUE_YEARS = 3;

const MIN_FISCAL_YEAR_DAYS = 357;
const MAX_FISCAL_YEAR_DAYS = 373;

/** Más reciente primero; el primero es el año base de la corrida. */
const revenueHistorySchema = z
  .array(
    z.object({
      fiscalYearEnd: calendarDateSchema,
      value: engineDecimalSchema,
    }),
  )
  .min(DERIVED_MIN_REVENUE_YEARS)
  .max(DERIVED_MAX_REVENUE_YEARS);

/**
 * La fila de la industria de la corrida en la release de Damodaran visible al
 * corte, como la congela un parámetro del costo de capital.
 */
export const industryReturnSchema = z.object({
  datasetId: z.literal(INDUSTRY_RETURNS_DATASET),
  releaseId: z.uuid(),
  rowKey: z.string().max(128),
  field: z.literal(INDUSTRY_RETURN_FIELD),
  value: engineDecimalSchema,
  publishedLabel: z.string().max(64).nullable(),
  availableAt: utcTimestampSchema,
});

export type IndustryReturn = z.infer<typeof industryReturnSchema>;

/** La fila de la industria en `damodaran.capex-us`, congelada igual. */
export const industrySalesToCapitalSchema = z.object({
  rule: z.literal(SALES_TO_CAPITAL_RULE_VERSION),
  datasetId: z.literal(INDUSTRY_CAPITAL_DATASET),
  releaseId: z.uuid(),
  rowKey: z.string().max(128),
  field: z.literal(INDUSTRY_SALES_TO_CAPITAL_FIELD),
  value: engineDecimalSchema,
  publishedLabel: z.string().max(64).nullable(),
  availableAt: utcTimestampSchema,
});

export type IndustrySalesToCapital = z.infer<
  typeof industrySalesToCapitalSchema
>;

/** Un ejercicio del consenso tal como estaba vigente al corte. */
const consensusRevenueYearSchema = z.object({
  /** El fin de mes con que la fuente etiqueta el ejercicio. */
  periodEnd: calendarDateSchema,
  revenueAverage: engineDecimalSchema,
  revenueLow: engineDecimalSchema,
  revenueHigh: engineDecimalSchema,
  analystCount: z.number().int().min(0).nullable(),
  /** La captura que publicó esta revisión. */
  availableAt: utcTimestampSchema,
});

export type ConsensusRevenueYear = z.infer<typeof consensusRevenueYearSchema>;

export const CONSENSUS_REVENUE_REASONS = [
  "no_consensus",
  "stale_consensus",
  "insufficient_horizons",
  "fiscal_year_gap",
  "revenue_incomplete",
  "non_positive_revenue",
  "currency_mismatch",
] as const;

export type ConsensusRevenueReason = (typeof CONSENSUS_REVENUE_REASONS)[number];

export const consensusRevenueSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("used"),
    rule: z.literal(CONSENSUS_REVENUE_PATH_VERSION),
    sourceId: z.literal(CONSENSUS_REVENUE_SOURCE_ID),
    datasetId: z.literal(CONSENSUS_REVENUE_DATASET),
    /** La última captura visible al corte: la que fecha el consenso. */
    capturedAt: utcTimestampSchema,
    fy1: consensusRevenueYearSchema,
    fy2: consensusRevenueYearSchema,
  }),
  z.object({
    status: z.literal("not_used"),
    rule: z.literal(CONSENSUS_REVENUE_PATH_VERSION),
    reason: z.enum(CONSENSUS_REVENUE_REASONS),
    /** `null` sin ninguna captura visible al corte. */
    capturedAt: utcTimestampSchema.nullable(),
  }),
]);

export type ConsensusRevenue = z.infer<typeof consensusRevenueSchema>;

const measuredDerivationFields = {
  revenueHistory: revenueHistorySchema,
  /** `null`: la industria no tiene ROC publicado o ninguna release se veía. */
  industryReturn: industryReturnSchema.nullable(),
  /**
   * Sólo cuando la ventas sobre capital propia no es positiva (`F6-31`).
   * Opcional: las corridas anteriores conservan su hash.
   */
  industrySalesToCapital: industrySalesToCapitalSchema.optional(),
};

export const derivedAssumptionsSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(DERIVED_ASSUMPTIONS_VERSION),
    revenueHistory: revenueHistorySchema,
  }),
  z.object({
    version: z.literal(DERIVED_ASSUMPTIONS_V2_VERSION),
    ...measuredDerivationFields,
  }),
  z.object({
    version: z.literal(DERIVED_ASSUMPTIONS_V3_VERSION),
    ...measuredDerivationFields,
    consensus: consensusRevenueSchema,
  }),
]);

export type DerivedAssumptions = z.infer<typeof derivedAssumptionsSchema>;

type MeasuredDerivation = Extract<
  DerivedAssumptions,
  {
    version:
      | typeof DERIVED_ASSUMPTIONS_V2_VERSION
      | typeof DERIVED_ASSUMPTIONS_V3_VERSION;
  }
>;

/** `2.0.0` y `3.0.0` comparten tendencia, ROIC terminal y escenarios medidos. */
export function isMeasuredDerivation(
  derivation: DerivedAssumptions,
): derivation is MeasuredDerivation {
  return (
    derivation.version === DERIVED_ASSUMPTIONS_V2_VERSION ||
    derivation.version === DERIVED_ASSUMPTIONS_V3_VERSION
  );
}

/** El consenso que la derivación usa, o `null`. */
export function usedConsensusOf(
  derivation: DerivedAssumptions,
): Extract<ConsensusRevenue, { status: "used" }> | null {
  return derivation.version === DERIVED_ASSUMPTIONS_V3_VERSION &&
    derivation.consensus.status === "used"
    ? derivation.consensus
    : null;
}

/**
 * `consensus-revenue-path-1.0.0`, la decisión: FY1 es el primer ejercicio del
 * consenso que cierra después de FY0, a un año de FY0, y FY2 el siguiente.
 * Lo que no alcanza se nombra; nunca se completa con la historia.
 */
export function selectConsensusRevenue(input: {
  /** Los ejercicios vigentes al corte, no retirados, en cualquier orden. */
  readonly years: readonly {
    readonly periodEnd: string;
    readonly revenueAverage: string | null;
    readonly revenueLow: string | null;
    readonly revenueHigh: string | null;
    readonly analystCount: number | null;
    readonly availableAt: string;
  }[];
  /** La última captura visible al corte. */
  readonly capturedAt: string | null;
  /** El cierre del último ejercicio de la historia (FY0). */
  readonly historyEnd: string;
  /** El cierre del año base: FY0 o el del 10-Q en un TTM. */
  readonly baseAsOf: string;
  readonly asOf: string;
  readonly currency: string;
}): ConsensusRevenue {
  const notUsed = (reason: ConsensusRevenueReason): ConsensusRevenue => ({
    status: "not_used",
    rule: CONSENSUS_REVENUE_PATH_VERSION,
    reason,
    capturedAt: input.capturedAt,
  });

  if (input.capturedAt === null || input.years.length === 0) {
    return notUsed("no_consensus");
  }

  if (
    Math.abs(calendarDaysBetween(input.capturedAt.slice(0, 10), input.asOf)) >
    CONSENSUS_REVENUE_STALE_AFTER_DAYS
  ) {
    return notUsed("stale_consensus");
  }

  if (input.currency !== CONSENSUS_REVENUE_CURRENCY) {
    return notUsed("currency_mismatch");
  }

  const [fy1, fy2] = [...input.years]
    .filter((year) => year.periodEnd > input.historyEnd)
    .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd));

  if (fy1 === undefined || fy2 === undefined) {
    return notUsed("insufficient_horizons");
  }

  const yearApart = (from: string, to: string) => {
    const days = calendarDaysBetween(from, to);
    return days >= CONSENSUS_MIN_YEAR_DAYS && days <= CONSENSUS_MAX_YEAR_DAYS;
  };

  if (
    !yearApart(input.historyEnd, fy1.periodEnd) ||
    !yearApart(fy1.periodEnd, fy2.periodEnd) ||
    input.baseAsOf >= fy1.periodEnd
  ) {
    return notUsed("fiscal_year_gap");
  }

  const complete = (year: typeof fy1) =>
    year.revenueAverage !== null &&
    year.revenueLow !== null &&
    year.revenueHigh !== null
      ? {
          periodEnd: year.periodEnd,
          revenueAverage: year.revenueAverage,
          revenueLow: year.revenueLow,
          revenueHigh: year.revenueHigh,
          analystCount: year.analystCount,
          availableAt: year.availableAt,
        }
      : null;
  const first = complete(fy1);
  const second = complete(fy2);

  if (first === null || second === null) {
    return notUsed("revenue_incomplete");
  }

  if (
    [first, second].some((year) =>
      [year.revenueAverage, year.revenueLow, year.revenueHigh].some(
        (value) => !parseDecimal(value, "consensus.revenue").greaterThan(ZERO),
      ),
    )
  ) {
    return notUsed("non_positive_revenue");
  }

  return {
    status: "used",
    rule: CONSENSUS_REVENUE_PATH_VERSION,
    sourceId: CONSENSUS_REVENUE_SOURCE_ID,
    datasetId: CONSENSUS_REVENUE_DATASET,
    capturedAt: input.capturedAt,
    fy1: first,
    fy2: second,
  };
}

export type ConsensusLevel = "revenueAverage" | "revenueLow" | "revenueHigh";

/**
 * `consensus-revenue-path-1.0.0`, el camino: niveles de ventas en FY0, FY1 y
 * FY2 fechados en el calendario fiscal de la empresa (FY0 más uno y más dos
 * años, no el fin de mes de la etiqueta), interpolados geométricamente por
 * días y extendidos después de FY2 a la tasa FY1→FY2. Devuelve el crecimiento
 * de los años 1 y 2: el nivel al cierre de cada período sobre el anterior,
 * con las ventas reales del año base como punto de partida.
 */
export function consensusRevenueGrowth(input: {
  readonly consensus: Extract<ConsensusRevenue, { status: "used" }>;
  readonly level: ConsensusLevel;
  /** FY0: el último ejercicio de la historia. */
  readonly anchor: { readonly fiscalYearEnd: string; readonly value: string };
  /** Las ventas del año base: FY0, o el TTM al cierre del 10-Q. */
  readonly baseRevenue: string;
  /** Los cierres de los períodos 1 y 2. */
  readonly periodEnds: readonly [string, string];
}): readonly [Dec, Dec] {
  const t0 = input.anchor.fiscalYearEnd;
  const t1 = subtractCalendarYears(t0, -1);
  const t2 = subtractCalendarYears(t0, -2);
  const l0 = parseDecimal(input.anchor.value, "consensus.anchor");
  const l1 = parseDecimal(input.consensus.fy1[input.level], "consensus.fy1");
  const l2 = parseDecimal(input.consensus.fy2[input.level], "consensus.fy2");
  const segment = (
    from: string,
    start: Dec,
    to: string,
    end: Dec,
    at: string,
  ) =>
    start.times(
      end
        .dividedBy(start)
        .pow(
          parseDecimal(String(calendarDaysBetween(from, at)), "days").dividedBy(
            parseDecimal(String(calendarDaysBetween(from, to)), "span"),
          ),
        ),
    );
  const levelAt = (at: string) =>
    at <= t1 ? segment(t0, l0, t1, l1, at) : segment(t1, l1, t2, l2, at);
  const first = levelAt(input.periodEnds[0]);
  const second = levelAt(input.periodEnds[1]);

  return [
    first.dividedBy(parseDecimal(input.baseRevenue, "baseRevenue")).minus(ONE),
    second.dividedBy(first).minus(ONE),
  ];
}

/**
 * De dónde salió el ROIC terminal (`terminal-return-on-capital-1.0.0`). Todas
 * las bases que no son `industry` ni `company` caen en el WACC terminal, el
 * piso de Damodaran: crecer sin ventaja no crea ni destruye valor.
 */
export type TerminalReturnBasis =
  /** `1.0.0`: el WACC terminal, siempre. */
  | "cost_of_capital"
  /** El ROC de la industria, menor que el propio y mayor que el WACC. */
  | "industry"
  /** El ROIC ajustado propio, menor que el de la industria y mayor que el WACC. */
  | "company"
  /** El menor de los dos no supera al WACC terminal. */
  | "cost_of_capital_floor"
  | "no_industry_reference"
  | "no_company_return";

export type DerivedAssumptionsUnavailableReason =
  | "revenue_history_insufficient"
  | "revenue_history_non_positive"
  | "base_margin_unavailable"
  | "sales_to_capital_unavailable"
  | "tax_rate_unavailable";

export type DerivedAssumptionsResult =
  | {
      readonly status: "derived";
      readonly initialGrowth: string;
      readonly periods: readonly PeriodAssumption[];
      readonly terminal: TerminalAssumption;
      readonly terminalReturnBasis: TerminalReturnBasis;
      readonly sensitivity: SensitivitySpec;
      /** `null` en `1.0.0`, o cuando bear o bull no cambiarían nada. */
      readonly scenarios: ScenarioSet | null;
    }
  | {
      readonly status: "unavailable";
      readonly reason: DerivedAssumptionsUnavailableReason;
    };

/**
 * La racha de ejercicios consecutivos que termina en el año base, más reciente
 * primero. Un hueco corta la racha: una tasa sobre dos años no es anual.
 */
export function consecutiveRevenueHistory(
  years: readonly { fiscalYearEnd: string; value: string }[],
  baseFiscalYearEnd: string,
): DerivedAssumptions["revenueHistory"] {
  const sorted = [...years].sort((left, right) =>
    right.fiscalYearEnd.localeCompare(left.fiscalYearEnd),
  );
  const start = sorted.findIndex(
    (year) => year.fiscalYearEnd === baseFiscalYearEnd,
  );

  if (start < 0) {
    return [];
  }

  const run = [sorted[start]!];

  for (const year of sorted.slice(start + 1)) {
    const days = calendarDaysBetween(
      year.fiscalYearEnd,
      run.at(-1)!.fiscalYearEnd,
    );

    if (
      days < MIN_FISCAL_YEAR_DAYS ||
      days > MAX_FISCAL_YEAR_DAYS ||
      run.length === DERIVED_MAX_REVENUE_YEARS
    ) {
      break;
    }

    run.push(year);
  }

  return run.map(({ fiscalYearEnd, value }) => ({ fiscalYearEnd, value }));
}

/**
 * El valor del año: el punto de partida hasta `DERIVED_HOLD_YEARS` y una recta
 * hasta `end` en los años siguientes. Exportada porque el DCF inverso
 * (`market-implied-1.1.0`) mueve el crecimiento con esta misma forma.
 */
export function fade(start: Dec, end: Dec, year: number): Dec {
  if (year <= DERIVED_HOLD_YEARS) {
    return start;
  }

  const steps = DERIVED_EXPLICIT_YEARS - DERIVED_HOLD_YEARS;

  return start.plus(
    end
      .minus(start)
      .times(year - DERIVED_HOLD_YEARS)
      .dividedBy(steps),
  );
}

/**
 * Períodos, terminal y sensibilidad desde la historia de revenue, la
 * normalización y el costo de capital de la corrida. Pura y determinista:
 * lo que no alcanza se nombra, nunca se rellena.
 */
/** La ventas sobre capital ajustada propia, sólo si es positiva. */
export function ownSalesToCapitalOf(normalization: Normalization): Dec | null {
  const value = normalization.base.salesToCapitalAdjusted;

  if (value === null) {
    return null;
  }

  const parsed = parseDecimal(
    value,
    "normalization.base.salesToCapitalAdjusted",
  );

  return parsed.greaterThan(ZERO) ? parsed : null;
}

export function deriveAssumptions(input: {
  derivation: DerivedAssumptions;
  /** Desde donde se cuentan los períodos: el cierre del año base. */
  baseFiscalYearEnd: string;
  /**
   * El último ejercicio de la historia. Sólo difiere en un año base TTM
   * (`F6-24`, ADR 0081): la tendencia sigue anual desde el 10-K y los
   * períodos se cuentan desde el 10-Q.
   */
  historyEnd?: string;
  /**
   * Las ventas del año base. Sólo las lee el consenso de `3.0.0`; sin ellas,
   * las del último ejercicio de la historia (un año base anual).
   */
  baseRevenue?: string;
  normalization: Normalization;
  costOfCapital: CostOfCapital;
}): DerivedAssumptionsResult {
  const history = input.derivation.revenueHistory;

  if (
    history.length < DERIVED_MIN_REVENUE_YEARS ||
    history[0]?.fiscalYearEnd !== (input.historyEnd ?? input.baseFiscalYearEnd)
  ) {
    return { status: "unavailable", reason: "revenue_history_insufficient" };
  }

  const latest = parseDecimal(history[0].value, "revenueHistory.0");
  const oldest = parseDecimal(
    history.at(-1)!.value,
    `revenueHistory.${history.length - 1}`,
  );

  if (!latest.greaterThan(ZERO) || !oldest.greaterThan(ZERO)) {
    return { status: "unavailable", reason: "revenue_history_non_positive" };
  }

  const { base, taxRate } = input.normalization;

  if (base.ebitMarginAdjusted === null) {
    return { status: "unavailable", reason: "base_margin_unavailable" };
  }

  const ownSalesToCapital = ownSalesToCapitalOf(input.normalization);
  const industrySalesToCapital = isMeasuredDerivation(input.derivation)
    ? (input.derivation.industrySalesToCapital ?? null)
    : null;
  const chosenSalesToCapital =
    ownSalesToCapital ??
    (industrySalesToCapital !== null &&
    parseDecimal(industrySalesToCapital.value, "industrySalesToCapital").gt(
      ZERO,
    )
      ? parseDecimal(industrySalesToCapital.value, "industrySalesToCapital")
      : null);

  if (chosenSalesToCapital === null) {
    return { status: "unavailable", reason: "sales_to_capital_unavailable" };
  }

  if (taxRate.applied === null) {
    return { status: "unavailable", reason: "tax_rate_unavailable" };
  }

  const measured = isMeasuredDerivation(input.derivation);

  // La tendencia toma el logaritmo de cada año, no sólo de las puntas.
  if (
    measured &&
    history.some(
      (year, index) =>
        !parseDecimal(year.value, `revenueHistory.${index}`).greaterThan(ZERO),
    )
  ) {
    return { status: "unavailable", reason: "revenue_history_non_positive" };
  }

  const growthWindows = measured ? measuredGrowth(history) : null;
  const trendGrowth =
    growthWindows !== null
      ? growthWindows.trend
      : latest
          .dividedBy(oldest)
          .pow(ONE.dividedBy(history.length - 1))
          .minus(ONE);
  const { derived } = input.costOfCapital;
  const riskFree = parseDecimal(derived.riskFree, "costOfCapital.riskFree");
  const wacc = parseDecimal(derived.wacc, "costOfCapital.wacc");
  const terminalWacc = parseDecimal(
    derived.terminalWacc,
    "costOfCapital.terminalWacc",
  );
  const appliedTax = parseDecimal(taxRate.applied, "normalization.taxRate");
  const marginalTax = parseDecimal(
    marginalTaxRateOf(input.costOfCapital),
    "costOfCapital.marginalTaxRate",
  );
  const margin = formatDecimal(
    parseDecimal(base.ebitMarginAdjusted, "normalization.base.ebitMargin"),
    "ebitMargin",
  );
  const salesToCapital = formatDecimal(chosenSalesToCapital, "salesToCapital");

  const baseReturn =
    base.returnOnCapitalAdjusted === null
      ? null
      : parseDecimal(base.returnOnCapitalAdjusted, "normalization.base.roic");
  const terminalReturn = isMeasuredDerivation(input.derivation)
    ? terminalReturnOnCapital({
        industryReturn: input.derivation.industryReturn,
        baseReturn,
        terminalWacc,
      })
    : { basis: "cost_of_capital" as const, value: terminalWacc };
  const growthPath = (start: Dec, year: number) => fade(start, riskFree, year);
  const periodEnds = Array.from(
    { length: DERIVED_EXPLICIT_YEARS },
    (_, index) => subtractCalendarYears(input.baseFiscalYearEnd, -(index + 1)),
  );

  // `3.0.0`: los años del consenso desde su camino de niveles; el resto, la
  // tendencia de `2.0.0`.
  const consensus = usedConsensusOf(input.derivation);
  const consensusPath = (level: ConsensusLevel) =>
    consensus === null
      ? null
      : consensusRevenueGrowth({
          consensus,
          level,
          anchor: history[0],
          baseRevenue: input.baseRevenue ?? history[0].value,
          periodEnds: [periodEnds[0]!, periodEnds[1]!],
        });
  const withConsensus =
    (path: readonly Dec[] | null) =>
    (year: number): Dec =>
      path !== null && year <= CONSENSUS_REVENUE_YEARS
        ? path[year - 1]!
        : growthPath(trendGrowth, year);
  const baseGrowth = withConsensus(consensusPath("revenueAverage"));
  const initialGrowth = baseGrowth(1);

  const periods: PeriodAssumption[] = Array.from(
    { length: DERIVED_EXPLICIT_YEARS },
    (_, index) => {
      const year = index + 1;

      return {
        periodIndex: year,
        periodEnd: periodEnds[index]!,
        revenueGrowth: formatDecimal(
          baseGrowth(year),
          `periods.${index}.revenueGrowth`,
        ),
        ebitMargin: margin,
        taxRate: formatDecimal(
          fade(appliedTax, marginalTax, year),
          `periods.${index}.taxRate`,
        ),
        wacc: formatDecimal(
          fade(wacc, terminalWacc, year),
          `periods.${index}.wacc`,
        ),
        reinvestment: {
          convention: "sales_to_capital" as const,
          salesToCapital,
        },
      };
    },
  );

  const terminal: TerminalAssumption = {
    growth: formatDecimal(riskFree, "terminal.growth"),
    ebitMargin: margin,
    taxRate: formatDecimal(marginalTax, "terminal.taxRate"),
    wacc: formatDecimal(terminalWacc, "terminal.wacc"),
    returnOnCapital: formatDecimal(
      terminalReturn.value,
      "terminal.returnOnCapital",
    ),
  };

  return {
    status: "derived",
    initialGrowth: formatDecimal(initialGrowth, "initialGrowth"),
    periods,
    terminal,
    terminalReturnBasis: terminalReturn.basis,
    scenarios:
      growthWindows !== null
        ? derivedScenarios({
            periods,
            terminal,
            growth:
              consensus === null
                ? measuredGrowthScenarios(growthWindows, growthPath)
                : {
                    bear: withConsensus(consensusPath("revenueLow")),
                    bull: withConsensus(consensusPath("revenueHigh")),
                    ...CONSENSUS_SCENARIO_TEXT,
                  },
            terminalWacc,
            baseReturn,
          })
        : null,
    sensitivity: {
      wacc: {
        from: formatDecimal(terminalWacc.minus("0.02"), "sensitivity.wacc"),
        to: formatDecimal(terminalWacc.plus("0.02"), "sensitivity.wacc"),
        step: "0.01",
      },
      terminalGrowth: { from: "0", to: "0.04", step: "0.01" },
    },
  };
}

/**
 * Las tasas de crecimiento que la historia sostiene, en orden cronológico:
 * la tendencia log-lineal (mínimos cuadrados sobre `ln(ventas)`), el CAGR
 * entre puntas de la ventana completa y el de los últimos tres ejercicios
 * cuando la ventana es más larga. La tendencia es la base porque usa todos
 * los años; las puntas acotan bear y bull.
 */
export function measuredGrowth(history: DerivedAssumptions["revenueHistory"]): {
  trend: Dec;
  windows: readonly { years: number; cagr: Dec }[];
} {
  const values = [...history]
    .reverse()
    .map((year, index) =>
      parseDecimal(year.value, `revenueHistory.${history.length - 1 - index}`),
    );
  const logs = values.map((value) => value.ln());
  const count = values.length;
  const meanX = parseDecimal(String(count - 1), "count").dividedBy(2);
  const meanY = logs
    .reduce((total, value) => total.plus(value), ZERO)
    .dividedBy(count);
  let covariance = ZERO;
  let variance = ZERO;

  logs.forEach((value, index) => {
    const dx = parseDecimal(String(index), "index").minus(meanX);

    covariance = covariance.plus(dx.times(value.minus(meanY)));
    variance = variance.plus(dx.times(dx));
  });

  const cagr = (years: number) =>
    values
      .at(-1)!
      .dividedBy(values.at(-1 - years)!)
      .pow(ONE.dividedBy(years))
      .minus(ONE);
  const spans = [...new Set([count - 1, RECENT_GROWTH_YEARS])].filter(
    (years) => years >= 1 && years < count,
  );

  return {
    trend: covariance.dividedBy(variance).exp().minus(ONE),
    windows: spans.map((years) => ({ years, cagr: cagr(years) })),
  };
}

const RECENT_GROWTH_YEARS = 3;

/**
 * `terminal-return-on-capital-1.0.0`: el menor entre el ROC de la industria y
 * el ROIC ajustado propio —una empresa no se supone mejor que su industria a
 * perpetuidad, ni mejor que sí misma—, con piso en el WACC terminal. Sin una
 * de las dos referencias, el piso.
 */
export function terminalReturnOnCapital(input: {
  industryReturn: IndustryReturn | null;
  baseReturn: Dec | null;
  terminalWacc: Dec;
}): { basis: TerminalReturnBasis; value: Dec } {
  if (input.industryReturn === null) {
    return { basis: "no_industry_reference", value: input.terminalWacc };
  }

  if (input.baseReturn === null) {
    return { basis: "no_company_return", value: input.terminalWacc };
  }

  const industry = parseDecimal(
    input.industryReturn.value,
    "derivedAssumptions.industryReturn.value",
  );
  const lower = industry.lessThanOrEqualTo(input.baseReturn)
    ? { basis: "industry" as const, value: industry }
    : { basis: "company" as const, value: input.baseReturn };

  return lower.value.greaterThan(input.terminalWacc)
    ? lower
    : { basis: "cost_of_capital_floor", value: input.terminalWacc };
}

/**
 * Bear y bull desde lo medido (`scenario-set-1.0.0`). Sólo mueven lo que la
 * historia acota: el crecimiento inicial —el más bajo y el más alto entre la
 * tendencia y las ventanas— y el ROIC terminal —el WACC terminal o el ROIC
 * propio—. Un driver que no cambiaría nada no se declara; si un lado queda
 * sin drivers no hay escenarios, y se dice.
 */
type ScenarioGrowth = {
  readonly bear: (year: number) => Dec;
  readonly bull: (year: number) => Dec;
  readonly bearThesis: string;
  readonly bullThesis: string;
  readonly bearRationale: string;
  readonly bullRationale: string;
};

/** `2.0.0`: la tasa más baja y la más alta medidas, con la forma de la base. */
function measuredGrowthScenarios(
  growthWindows: ReturnType<typeof measuredGrowth>,
  growthPath: (start: Dec, year: number) => Dec,
): ScenarioGrowth {
  const rates = [
    growthWindows.trend,
    ...growthWindows.windows.map((window) => window.cagr),
  ];
  const lowest = rates.reduce((low, rate) => (rate.lessThan(low) ? rate : low));
  const highest = rates.reduce((high, rate) =>
    rate.greaterThan(high) ? rate : high,
  );

  return {
    bear: (year) => growthPath(lowest, year),
    bull: (year) => growthPath(highest, year),
    bearThesis:
      "Growth at the weakest measured rate and no excess returns after year 10.",
    bullThesis:
      "Growth at the strongest measured rate and the company's own return on capital in perpetuity.",
    bearRationale: `${DERIVED_ASSUMPTIONS_V2_VERSION}: the lowest of the log-linear trend and the window CAGRs.`,
    bullRationale: `${DERIVED_ASSUMPTIONS_V2_VERSION}: the highest of the log-linear trend and the window CAGRs.`,
  };
}

/** `3.0.0`: el rango de los analistas en los años del consenso. */
const CONSENSUS_SCENARIO_TEXT = {
  bearThesis:
    "Revenue at the analysts' lowest estimate for two years, then the base path, and no excess returns after year 10.",
  bullThesis:
    "Revenue at the analysts' highest estimate for two years, then the base path, and the company's own return on capital in perpetuity.",
  bearRationale: `${CONSENSUS_REVENUE_PATH_VERSION}: years 1 and 2 from the lowest analyst revenue estimate; later years as the base.`,
  bullRationale: `${CONSENSUS_REVENUE_PATH_VERSION}: years 1 and 2 from the highest analyst revenue estimate; later years as the base.`,
} as const;

function derivedScenarios(input: {
  periods: readonly PeriodAssumption[];
  terminal: TerminalAssumption;
  growth: ScenarioGrowth;
  terminalWacc: Dec;
  baseReturn: Dec | null;
}): ScenarioSet | null {
  const baseTerminalReturn = parseDecimal(
    input.terminal.returnOnCapital,
    "terminal.returnOnCapital",
  );

  const growthDriver = (
    growthAt: (year: number) => Dec,
    rationale: string,
  ): ScenarioDriver | null => {
    const values = input.periods.map((period, index) => {
      const value = growthAt(index + 1);

      return value.eq(parseDecimal(period.revenueGrowth, "revenueGrowth"))
        ? null
        : formatDecimal(value, `scenarios.revenueGrowth.${index}`);
    });

    return values.every((value) => value === null)
      ? null
      : { driver: "revenueGrowth", values, rationale };
  };
  const returnDriver = (
    value: Dec | null,
    rationale: string,
  ): ScenarioDriver | null =>
    value === null || value.eq(baseTerminalReturn)
      ? null
      : {
          driver: "terminalReturnOnCapital",
          value: formatDecimal(value, "scenarios.terminalReturnOnCapital"),
          rationale,
        };
  const scenario = (
    thesis: string,
    drivers: readonly (ScenarioDriver | null)[],
  ): Scenario | null => {
    const declared = drivers.filter(
      (driver): driver is ScenarioDriver => driver !== null,
    );

    return declared.length === 0 ? null : { thesis, drivers: declared };
  };

  const bear = scenario(input.growth.bearThesis, [
    growthDriver(input.growth.bear, input.growth.bearRationale),
    returnDriver(
      input.terminalWacc,
      `${TERMINAL_RETURN_RULE_VERSION}: terminal ROIC at the terminal WACC, growth without advantage.`,
    ),
  ]);
  const bull = scenario(input.growth.bullThesis, [
    growthDriver(input.growth.bull, input.growth.bullRationale),
    returnDriver(
      input.baseReturn !== null &&
        input.baseReturn.greaterThan(input.terminalWacc)
        ? input.baseReturn
        : null,
      `${TERMINAL_RETURN_RULE_VERSION}: terminal ROIC at the base year's adjusted ROIC.`,
    ),
  ]);

  return bear === null || bull === null
    ? null
    : { version: SCENARIO_SET_VERSION, bear, bull };
}

/**
 * Lo que no coincide entre el snapshot y su derivación. El año base tiene que
 * ser el revenue de la corrida, y períodos, terminal y sensibilidad los que la
 * regla reconstruye: un supuesto escrito a mano sobre una derivación es un
 * rechazo, no un ajuste.
 */
export function derivedAssumptionsMismatches(input: {
  derivation: DerivedAssumptions;
  baseRevenue: { value: string; asOf: string };
  /**
   * Las ventas del último ejercicio cuando el año base es TTM (`F6-24`): la
   * historia termina ahí, no en las ventas TTM.
   */
  historyBase?: { value: string; fiscalYearEnd: string };
  normalization: Normalization;
  costOfCapital: CostOfCapital;
  periods: readonly PeriodAssumption[];
  terminal: TerminalAssumption;
  sensitivity: SensitivitySpec | null;
  scenarios: ScenarioSet | null;
  /**
   * Lo que otra regla cambia sobre lo derivado antes de comparar: una cíclica
   * (`F6-18`) reemplaza crecimiento, margen y escenarios.
   */
  reshape?: (rebuilt: {
    readonly periods: readonly PeriodAssumption[];
    readonly terminal: TerminalAssumption;
    readonly scenarios: ScenarioSet | null;
  }) => {
    readonly periods: readonly PeriodAssumption[];
    readonly terminal: TerminalAssumption;
    readonly scenarios: ScenarioSet | null;
  };
  /**
   * El `as_of`, el corte de conocimiento y la moneda de la corrida: con ellos
   * se vuelve a decidir el consenso de `3.0.0`.
   */
  run?: { asOf: string; knownAt: string; currency: string };
}): string[] {
  const mismatches: string[] = [];
  const { derivation } = input;

  // La fila tiene que ser la de la industria con la que se armó el WACC.
  if (
    isMeasuredDerivation(derivation) &&
    derivation.industryReturn !== null &&
    derivation.industryReturn.rowKey !== input.costOfCapital.industryKey
  ) {
    mismatches.push("derivedAssumptions.industryReturn");
  }

  if (
    derivation.version === DERIVED_ASSUMPTIONS_V3_VERSION &&
    derivation.consensus.status === "used" &&
    !consensusDecisionHolds({
      consensus: derivation.consensus,
      historyEnd: derivation.revenueHistory[0]?.fiscalYearEnd ?? "",
      baseAsOf: input.baseRevenue.asOf,
      run: input.run,
    })
  ) {
    mismatches.push("derivedAssumptions.consensus");
  }

  // La de la industria sólo reemplaza a una propia que no sirve, y es la fila
  // de la industria del WACC.
  if (
    isMeasuredDerivation(derivation) &&
    derivation.industrySalesToCapital !== undefined &&
    (ownSalesToCapitalOf(input.normalization) !== null ||
      derivation.industrySalesToCapital.rowKey !==
        input.costOfCapital.industryKey)
  ) {
    mismatches.push("derivedAssumptions.industrySalesToCapital");
  }
  const [base] = input.derivation.revenueHistory;
  const historyBase = input.historyBase ?? {
    value: input.baseRevenue.value,
    fiscalYearEnd: input.baseRevenue.asOf,
  };

  if (
    base === undefined ||
    base.fiscalYearEnd !== historyBase.fiscalYearEnd ||
    !parseDecimal(base.value, "revenueHistory.0").eq(
      parseDecimal(historyBase.value, "baseRevenue"),
    )
  ) {
    mismatches.push("derivedAssumptions.revenueHistory");
  }

  const derived = deriveAssumptions({
    derivation: input.derivation,
    baseFiscalYearEnd: input.baseRevenue.asOf,
    ...(input.historyBase === undefined
      ? {}
      : { historyEnd: input.historyBase.fiscalYearEnd }),
    baseRevenue: input.baseRevenue.value,
    normalization: input.normalization,
    costOfCapital: input.costOfCapital,
  });

  if (derived.status === "unavailable") {
    return [...mismatches, "derivedAssumptions"];
  }

  const rebuilt =
    input.reshape === undefined
      ? derived
      : { ...derived, ...input.reshape(derived) };

  if (
    rebuilt.periods.length !== input.periods.length ||
    rebuilt.periods.some(
      (period, index) => !samePeriod(period, input.periods[index]!),
    )
  ) {
    mismatches.push("periods");
  }

  const terminalKeys = [
    "growth",
    "ebitMargin",
    "taxRate",
    "wacc",
    "returnOnCapital",
  ] as const;

  if (
    terminalKeys.some(
      (key) =>
        !parseDecimal(rebuilt.terminal[key], `terminal.${key}`).eq(
          parseDecimal(input.terminal[key], `terminal.${key}`),
        ),
    )
  ) {
    mismatches.push("terminal");
  }

  if (
    input.sensitivity === null ||
    JSON.stringify(rebuilt.sensitivity) !== JSON.stringify(input.sensitivity)
  ) {
    mismatches.push("sensitivity");
  }

  if (JSON.stringify(rebuilt.scenarios) !== JSON.stringify(input.scenarios)) {
    mismatches.push("scenarios");
  }

  return mismatches;
}

/**
 * El consenso congelado vuelve a decidirse igual con lo que la corrida sabe:
 * la captura no es posterior al corte ni sus revisiones a la captura, y la
 * misma selección sobre los dos ejercicios elige esos dos ejercicios.
 */
function consensusDecisionHolds(input: {
  consensus: Extract<ConsensusRevenue, { status: "used" }>;
  historyEnd: string;
  baseAsOf: string;
  run: { asOf: string; knownAt: string; currency: string } | undefined;
}): boolean {
  const { consensus, run } = input;

  if (run === undefined) {
    return false;
  }

  const captured = Date.parse(consensus.capturedAt);

  if (
    captured > Date.parse(run.knownAt) ||
    [consensus.fy1, consensus.fy2].some(
      (year) => Date.parse(year.availableAt) > captured,
    )
  ) {
    return false;
  }

  const again = selectConsensusRevenue({
    years: [consensus.fy1, consensus.fy2],
    capturedAt: consensus.capturedAt,
    historyEnd: input.historyEnd,
    baseAsOf: input.baseAsOf,
    asOf: run.asOf,
    currency: run.currency,
  });

  const sameYear = (left: ConsensusRevenueYear, right: ConsensusRevenueYear) =>
    left.periodEnd === right.periodEnd &&
    left.revenueAverage === right.revenueAverage &&
    left.revenueLow === right.revenueLow &&
    left.revenueHigh === right.revenueHigh &&
    left.analystCount === right.analystCount &&
    left.availableAt === right.availableAt;

  return (
    again.status === "used" &&
    sameYear(again.fy1, consensus.fy1) &&
    sameYear(again.fy2, consensus.fy2)
  );
}

function samePeriod(left: PeriodAssumption, right: PeriodAssumption): boolean {
  const equal = (a: string, b: string, path: string) =>
    parseDecimal(a, path).eq(parseDecimal(b, path));

  return (
    left.periodIndex === right.periodIndex &&
    left.periodEnd === right.periodEnd &&
    equal(left.revenueGrowth, right.revenueGrowth, "revenueGrowth") &&
    equal(left.ebitMargin, right.ebitMargin, "ebitMargin") &&
    equal(left.taxRate, right.taxRate, "taxRate") &&
    equal(left.wacc, right.wacc, "wacc") &&
    right.reinvestment.convention === "sales_to_capital" &&
    left.reinvestment.convention === "sales_to_capital" &&
    equal(
      left.reinvestment.salesToCapital,
      right.reinvestment.salesToCapital,
      "salesToCapital",
    )
  );
}

/**
 * Lo que la página dice de una derivación `2.0.0`, en strings: la tendencia y
 * las ventanas medidas, y la base del ROIC terminal. Recalcula con las mismas
 * funciones que el check, desde lo que el snapshot congeló.
 */
export type DerivationExplanation = {
  readonly trend: string;
  readonly windows: readonly { years: number; cagr: string }[];
  readonly terminalReturnBasis: TerminalReturnBasis;
  readonly industryReturn: IndustryReturn | null;
  readonly baseReturn: string | null;
  /** `F6-31`: la de la industria cuando la propia no era positiva. */
  readonly industrySalesToCapital: IndustrySalesToCapital | null;
  /** `3.0.0`: la decisión del consenso congelada; `null` antes de `3.0.0`. */
  readonly consensus: ConsensusRevenue | null;
};

export function explainDerivation(input: {
  derivation: DerivedAssumptions;
  normalization: Normalization;
  costOfCapital: CostOfCapital;
}): DerivationExplanation | null {
  const { derivation } = input;

  if (
    !isMeasuredDerivation(derivation) ||
    derivation.revenueHistory.some(
      (year, index) =>
        !parseDecimal(year.value, `revenueHistory.${index}`).greaterThan(ZERO),
    )
  ) {
    return null;
  }

  const growth = measuredGrowth(derivation.revenueHistory);
  const baseReturn = input.normalization.base.returnOnCapitalAdjusted;

  return {
    trend: formatDecimal(growth.trend, "trend"),
    windows: growth.windows.map((window) => ({
      years: window.years,
      cagr: formatDecimal(window.cagr, "cagr"),
    })),
    terminalReturnBasis: terminalReturnOnCapital({
      industryReturn: derivation.industryReturn,
      baseReturn:
        baseReturn === null ? null : parseDecimal(baseReturn, "baseReturn"),
      terminalWacc: parseDecimal(
        input.costOfCapital.derived.terminalWacc,
        "terminalWacc",
      ),
    }).basis,
    industryReturn: derivation.industryReturn,
    baseReturn,
    industrySalesToCapital: derivation.industrySalesToCapital ?? null,
    consensus:
      derivation.version === DERIVED_ASSUMPTIONS_V3_VERSION
        ? derivation.consensus
        : null,
  };
}
