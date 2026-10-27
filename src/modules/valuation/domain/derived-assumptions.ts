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
 */
export const DERIVED_ASSUMPTIONS_VERSION = "derived-assumptions-1.0.0";
export const DERIVED_ASSUMPTIONS_V2_VERSION = "derived-assumptions-2.0.0";
export const TERMINAL_RETURN_RULE_VERSION = "terminal-return-on-capital-1.0.0";
/** ROC después de impuestos por industria, de la página EVA de Damodaran. */
export const INDUSTRY_RETURNS_DATASET = "damodaran.eva-us";
export const INDUSTRY_RETURN_FIELD = "roc";

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

export const derivedAssumptionsSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(DERIVED_ASSUMPTIONS_VERSION),
    revenueHistory: revenueHistorySchema,
  }),
  z.object({
    version: z.literal(DERIVED_ASSUMPTIONS_V2_VERSION),
    revenueHistory: revenueHistorySchema,
    /** `null`: la industria no tiene ROC publicado o ninguna release se veía. */
    industryReturn: industryReturnSchema.nullable(),
  }),
]);

export type DerivedAssumptions = z.infer<typeof derivedAssumptionsSchema>;

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
 * (`market-implied-1.0.0`) mueve el crecimiento con esta misma forma.
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
export function deriveAssumptions(input: {
  derivation: DerivedAssumptions;
  baseFiscalYearEnd: string;
  normalization: Normalization;
  costOfCapital: CostOfCapital;
}): DerivedAssumptionsResult {
  const history = input.derivation.revenueHistory;

  if (
    history.length < DERIVED_MIN_REVENUE_YEARS ||
    history[0]?.fiscalYearEnd !== input.baseFiscalYearEnd
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

  if (
    base.salesToCapitalAdjusted === null ||
    !parseDecimal(
      base.salesToCapitalAdjusted,
      "normalization.base.salesToCapitalAdjusted",
    ).greaterThan(ZERO)
  ) {
    return { status: "unavailable", reason: "sales_to_capital_unavailable" };
  }

  if (taxRate.applied === null) {
    return { status: "unavailable", reason: "tax_rate_unavailable" };
  }

  const v2 = input.derivation.version === DERIVED_ASSUMPTIONS_V2_VERSION;

  // La tendencia toma el logaritmo de cada año, no sólo de las puntas.
  if (
    v2 &&
    history.some(
      (year, index) =>
        !parseDecimal(year.value, `revenueHistory.${index}`).greaterThan(ZERO),
    )
  ) {
    return { status: "unavailable", reason: "revenue_history_non_positive" };
  }

  const growthWindows = v2 ? measuredGrowth(history) : null;
  const initialGrowth =
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
  const salesToCapital = formatDecimal(
    parseDecimal(base.salesToCapitalAdjusted, "salesToCapital"),
    "salesToCapital",
  );

  const baseReturn =
    base.returnOnCapitalAdjusted === null
      ? null
      : parseDecimal(base.returnOnCapitalAdjusted, "normalization.base.roic");
  const terminalReturn =
    input.derivation.version === DERIVED_ASSUMPTIONS_V2_VERSION
      ? terminalReturnOnCapital({
          industryReturn: input.derivation.industryReturn,
          baseReturn,
          terminalWacc,
        })
      : { basis: "cost_of_capital" as const, value: terminalWacc };
  const growthPath = (start: Dec, year: number) => fade(start, riskFree, year);

  const periods: PeriodAssumption[] = Array.from(
    { length: DERIVED_EXPLICIT_YEARS },
    (_, index) => {
      const year = index + 1;

      return {
        periodIndex: year,
        periodEnd: subtractCalendarYears(input.baseFiscalYearEnd, -year),
        revenueGrowth: formatDecimal(
          growthPath(initialGrowth, year),
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
            growthPath,
            growthWindows,
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
function derivedScenarios(input: {
  periods: readonly PeriodAssumption[];
  terminal: TerminalAssumption;
  growthPath: (start: Dec, year: number) => Dec;
  growthWindows: ReturnType<typeof measuredGrowth>;
  terminalWacc: Dec;
  baseReturn: Dec | null;
}): ScenarioSet | null {
  const rates = [
    input.growthWindows.trend,
    ...input.growthWindows.windows.map((window) => window.cagr),
  ];
  const lowest = rates.reduce((low, rate) => (rate.lessThan(low) ? rate : low));
  const highest = rates.reduce((high, rate) =>
    rate.greaterThan(high) ? rate : high,
  );
  const baseTerminalReturn = parseDecimal(
    input.terminal.returnOnCapital,
    "terminal.returnOnCapital",
  );

  const growthDriver = (
    start: Dec,
    rationale: string,
  ): ScenarioDriver | null => {
    const values = input.periods.map((period, index) => {
      const value = input.growthPath(start, index + 1);

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

  const bear = scenario(
    "Growth at the weakest measured rate and no excess returns after year 10.",
    [
      growthDriver(
        lowest,
        `${DERIVED_ASSUMPTIONS_V2_VERSION}: the lowest of the log-linear trend and the window CAGRs.`,
      ),
      returnDriver(
        input.terminalWacc,
        `${TERMINAL_RETURN_RULE_VERSION}: terminal ROIC at the terminal WACC, growth without advantage.`,
      ),
    ],
  );
  const bull = scenario(
    "Growth at the strongest measured rate and the company's own return on capital in perpetuity.",
    [
      growthDriver(
        highest,
        `${DERIVED_ASSUMPTIONS_V2_VERSION}: the highest of the log-linear trend and the window CAGRs.`,
      ),
      returnDriver(
        input.baseReturn !== null &&
          input.baseReturn.greaterThan(input.terminalWacc)
          ? input.baseReturn
          : null,
        `${TERMINAL_RETURN_RULE_VERSION}: terminal ROIC at the base year's adjusted ROIC.`,
      ),
    ],
  );

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
}): string[] {
  const mismatches: string[] = [];
  const { derivation } = input;

  // La fila tiene que ser la de la industria con la que se armó el WACC.
  if (
    derivation.version === DERIVED_ASSUMPTIONS_V2_VERSION &&
    derivation.industryReturn !== null &&
    derivation.industryReturn.rowKey !== input.costOfCapital.industryKey
  ) {
    mismatches.push("derivedAssumptions.industryReturn");
  }
  const [base] = input.derivation.revenueHistory;

  if (
    base === undefined ||
    base.fiscalYearEnd !== input.baseRevenue.asOf ||
    !parseDecimal(base.value, "revenueHistory.0").eq(
      parseDecimal(input.baseRevenue.value, "baseRevenue"),
    )
  ) {
    mismatches.push("derivedAssumptions.revenueHistory");
  }

  const derived = deriveAssumptions({
    derivation: input.derivation,
    baseFiscalYearEnd: input.baseRevenue.asOf,
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
};

export function explainDerivation(input: {
  derivation: DerivedAssumptions;
  normalization: Normalization;
  costOfCapital: CostOfCapital;
}): DerivationExplanation | null {
  const { derivation } = input;

  if (
    derivation.version !== DERIVED_ASSUMPTIONS_V2_VERSION ||
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
  };
}
