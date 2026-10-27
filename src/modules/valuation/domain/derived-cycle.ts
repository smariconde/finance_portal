import type { AnnualFundamentals, LineItemValue } from "./annual-fundamentals";
import {
  buildCapitalization,
  capitalizationFactsFromSeries,
} from "./capitalization-bridge";
import {
  CYCLE_NORMALIZATION_VERSION,
  deriveCycleNormalization,
  type CycleNormalization,
} from "./cycle-normalization";
import {
  divide,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import { ebitOf } from "./interest-expense";
import type { ProfileEvidence } from "./method-selection";
import { SCENARIO_SET_VERSION, type ScenarioSet } from "./scenarios";
import type { MonetaryFact } from "./valuation-facts";
import type { PeriodAssumption, TerminalAssumption } from "./valuation-input";

/**
 * La historia de ciclo derivada de lo guardado (`F6-18`,
 * [ADR 0059](../../../../docs/architecture/adr/0059-derived-cycle-normalization.md)).
 *
 * `normalized_fcff` (ADR 0042) pedía al owner un snapshot privado con la
 * historia, los años hasta normalizar y un corrimiento de margen. Esta regla
 * los arma desde la serie anual que la corrida ya leyó:
 *
 * - **Historia:** los ejercicios consecutivos con ventas y EBIT que terminan
 *   en el ejercicio base, entre cinco y diez. Cada uno lleva la capitalización
 *   de arrendamientos e I+D de sus propios hechos, con el costo de deuda y la
 *   industria de la corrida, así que todos los años están en la misma base que
 *   el ejercicio base. El ejercicio base es el EBIT ajustado de la
 *   normalización, que además revierte cargos no recurrentes.
 * - **Convergencia:** tres años, decisión del owner del 2026-10-26.
 * - **Ventas:** crecen a la tasa terminal desde el año 1 (`applyDerivedCycle`),
 *   otra decisión del mismo día.
 * - **Corrimiento:** ninguno. Un corrimiento es un juicio y no sale de una
 *   regla.
 *
 * Sin cinco años, con un margen medio no positivo o sin base ajustada, la
 * regla no arma nada y nombra por qué: el selector sigue pidiendo
 * `cycle_margins`.
 */
export const DERIVED_CYCLE_VERSION = "derived-cycle-1.0.0";

export const DERIVED_CYCLE_CONVERGENCE_YEARS = 3;
export const CYCLE_MIN_YEARS = 5;
export const CYCLE_MAX_YEARS = 10;
/** Decimales del margen objetivo de bear y bull. */
const SCENARIO_MARGIN_DECIMALS = 4;

/** Un ejercicio dura entre 350 y 380 días, como exige el motor de ciclo. */
const MIN_GAP_DAYS = 350;
const MAX_GAP_DAYS = 380;

export type DerivedCycleUnavailableReason =
  /** Menos de cinco ejercicios consecutivos con ventas y EBIT. */
  | "insufficient_cycle_years"
  /** El margen medio del ciclo no es positivo: es un caso de pérdidas. */
  | "non_positive_cycle_margin"
  /** El ejercicio base no tiene EBIT ajustado en la normalización. */
  | "base_not_adjusted";

export type DerivedCycle =
  | {
      readonly status: "ready";
      readonly history: CycleNormalization["history"];
      /** Margen medio, para la evaluación y la página; el motor lo recalcula. */
      readonly historicalMargin: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: DerivedCycleUnavailableReason;
      readonly years: number;
    };

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
  86_400_000;

/** EBIT con la capitalización de los hechos de ese mismo ejercicio. */
function adjustedEbitOf(
  series: AnnualFundamentals,
  index: number,
  context: {
    readonly toFact: (item: LineItemValue) => MonetaryFact;
    readonly industryKey: string | null;
    readonly preTaxCostOfDebt: string | null;
  },
): string | null {
  const year = series.fiscalYears[index]!;
  const revenue = year.items.revenue;
  // La capitalización de un año mira ese año y los anteriores, nunca los
  // posteriores: la I+D se amortiza con lo que ya se había gastado.
  const facts = capitalizationFactsFromSeries(
    { ...series, fiscalYears: series.fiscalYears.slice(index) },
    context.toFact,
  );

  if (revenue === undefined || facts === null) return null;

  return buildCapitalization(facts, {
    baseRevenue: revenue.value,
    industryKey: context.industryKey,
    preTaxCostOfDebt: context.preTaxCostOfDebt,
  }).ledger.ebit.adjusted;
}

/** La historia de ciclo que la regla arma al corte de la serie. Pura. */
export function deriveCycleHistory(
  series: AnnualFundamentals,
  context: {
    readonly toFact: (item: LineItemValue) => MonetaryFact;
    readonly industryKey: string | null;
    readonly preTaxCostOfDebt: string | null;
    /** `normalization.base.ebitAdjusted` de la corrida. */
    readonly baseEbitAdjusted: string | null;
  },
): DerivedCycle {
  // Del ejercicio base hacia atrás, mientras sean consecutivos y completos.
  const picked: number[] = [];
  for (const [index, year] of series.fiscalYears.entries()) {
    if (picked.length === CYCLE_MAX_YEARS) break;
    if (year.items.revenue === undefined || ebitOf(year) === null) break;

    const previous = picked.at(-1);
    if (previous !== undefined) {
      const gap = daysBetween(
        year.fiscalYearEnd,
        series.fiscalYears[previous]!.fiscalYearEnd,
      );
      if (gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) break;
    }
    picked.push(index);
  }

  if (picked.length < CYCLE_MIN_YEARS) {
    return {
      status: "unavailable",
      reason: "insufficient_cycle_years",
      years: picked.length,
    };
  }

  if (context.baseEbitAdjusted === null) {
    return {
      status: "unavailable",
      reason: "base_not_adjusted",
      years: picked.length,
    };
  }

  const history = picked
    .map((index) => {
      const year = series.fiscalYears[index]!;
      const revenue = context.toFact(year.items.revenue!);
      const ebitSource = ebitOf(year)!.inputs[0]!;
      const ebit =
        index === 0
          ? context.baseEbitAdjusted
          : adjustedEbitOf(series, index, context);

      return {
        fiscalYearEnd: year.fiscalYearEnd,
        revenue,
        ebit:
          ebit === null ? null : { ...context.toFact(ebitSource), value: ebit },
      };
    })
    .reverse();

  if (history.some((year) => year.ebit === null)) {
    return {
      status: "unavailable",
      reason: "insufficient_cycle_years",
      years: history.filter((year) => year.ebit !== null).length,
    };
  }

  const margins = history.map((year) =>
    divide(
      parseDecimal(year.ebit!.value, "cycle.ebit"),
      parseDecimal(year.revenue.value, "cycle.revenue"),
      "cycle.revenue",
    ),
  );
  const mean = divide(
    sum(margins),
    parseDecimal(String(margins.length), "cycle.years"),
    "cycle.years",
  );

  if (!mean.greaterThan(ZERO)) {
    return {
      status: "unavailable",
      reason: "non_positive_cycle_margin",
      years: history.length,
    };
  }

  return {
    status: "ready",
    history,
    historicalMargin: mean.toString(),
  };
}

/** El bloque `cycleNormalization` del snapshot con los textos de la regla. */
export function derivedCycleNormalization(input: {
  readonly history: CycleNormalization["history"];
  readonly profileEvidence: readonly ProfileEvidence[];
  readonly employeeEquityAvailableAt: string;
}): CycleNormalization {
  const first = input.history[0]!.fiscalYearEnd;
  const last = input.history.at(-1)!.fiscalYearEnd;

  return {
    version: CYCLE_NORMALIZATION_VERSION,
    profileEvidence: [...input.profileEvidence],
    cycleRationale: `${DERIVED_CYCLE_VERSION}: the ${input.history.length} consecutive fiscal years from ${first} to ${last} stored by the SEC window, weighted equally; a window this short may not span a full cycle, so the run stays screening.`,
    accountingBasis: `${DERIVED_CYCLE_VERSION}: every year carries the lease and R&D capitalization of its own facts at the run's cost of debt and industry life; only the base year also carries the non-recurring reversal of the normalization.`,
    inflationBasis: "same_year_nominal_ratios",
    history: [...input.history],
    convergenceYears: DERIVED_CYCLE_CONVERGENCE_YEARS,
    employeeEquityAvailableAt: input.employeeEquityAvailableAt,
    marginShift: null,
  };
}

type CycleAssumptions = {
  readonly periods: readonly PeriodAssumption[];
  readonly terminal: TerminalAssumption;
  readonly scenarios: ScenarioSet | null;
};

/**
 * Los supuestos derivados de una cíclica (decisión del owner del 2026-10-26):
 * las ventas crecen a la tasa terminal desde el año 1, porque la tendencia de
 * la ventana arranca en un piso o un pico del ciclo; el margen sigue la
 * trayectoria de ciclo; y bear y bull mueven el margen objetivo al peor y al
 * mejor margen positivo del ciclo medido. Tasa, impuestos, reinversión y ROIC
 * terminal quedan como los armó la regla. Pura: el armado y el check la usan.
 */
export function applyDerivedCycle(
  assumptions: CycleAssumptions,
  input: {
    readonly cycle: CycleNormalization;
    readonly baseRevenue: string;
    readonly baseEbitAdjusted: string | null;
  },
): CycleAssumptions {
  const trajectory = deriveCycleNormalization(
    input.cycle,
    input.baseRevenue,
    input.baseEbitAdjusted,
    assumptions.periods.length,
  );
  const target = parseDecimal(trajectory.targetMargin, "cycle.target");
  const positive = trajectory.annualMargins
    .map((margin) => parseDecimal(margin, "cycle.margin"))
    .filter((margin) => margin.greaterThan(ZERO));
  const lowest = positive.reduce(
    (low, margin) => (margin.lessThan(low) ? margin : low),
    target,
  );
  const highest = positive.reduce(
    (high, margin) => (margin.greaterThan(high) ? margin : high),
    target,
  );
  const scenario = (
    measured: typeof target,
    thesis: string,
    rationale: string,
  ) => {
    // A cuatro decimales (0,01 punto): el escenario vuelve a la trayectoria
    // como `objetivo − media`, y un margen de 34 dígitos no sobrevive exacto
    // a esa ida y vuelta.
    const value = measured.toDecimalPlaces(SCENARIO_MARGIN_DECIMALS);

    return value.eq(target)
      ? null
      : {
          thesis,
          drivers: [
            {
              driver: "terminalEbitMargin" as const,
              value: formatDecimal(value, "scenarios.terminalEbitMargin"),
              rationale: `${DERIVED_CYCLE_VERSION}: ${rationale}`,
            },
          ],
        };
  };
  const bear = scenario(
    lowest,
    "The margin converges to the weakest positive margin of the measured cycle.",
    "the lowest positive annual margin of the cycle history, to four decimals.",
  );
  const bull = scenario(
    highest,
    "The margin converges to the strongest margin of the measured cycle.",
    "the highest annual margin of the cycle history, to four decimals.",
  );

  return {
    periods: assumptions.periods.map((period, index) => ({
      ...period,
      revenueGrowth: assumptions.terminal.growth,
      ebitMargin: trajectory.periodMargins[index]!,
    })),
    terminal: { ...assumptions.terminal, ebitMargin: trajectory.targetMargin },
    scenarios:
      bear === null || bull === null
        ? null
        : { version: SCENARIO_SET_VERSION, bear, bull },
  };
}
