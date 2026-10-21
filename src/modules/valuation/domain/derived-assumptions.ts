import { z } from "zod";

import {
  calendarDaysBetween,
  subtractCalendarYears,
} from "@/modules/temporal/domain/calendar-date";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

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
 */
export const DERIVED_ASSUMPTIONS_VERSION = "derived-assumptions-1.0.0";

export const DERIVED_EXPLICIT_YEARS = 10;
/** Último año que sostiene el punto de partida; desde el siguiente converge. */
export const DERIVED_HOLD_YEARS = 5;
/** Ejercicios consecutivos como máximo: cinco tasas de crecimiento. */
export const DERIVED_MAX_REVENUE_YEARS = 6;
/** Dos tasas como mínimo: una sola es un año, no una tendencia. */
export const DERIVED_MIN_REVENUE_YEARS = 3;

const MIN_FISCAL_YEAR_DAYS = 357;
const MAX_FISCAL_YEAR_DAYS = 373;

export const derivedAssumptionsSchema = z.object({
  version: z.literal(DERIVED_ASSUMPTIONS_VERSION),
  /** Más reciente primero; el primero es el año base de la corrida. */
  revenueHistory: z
    .array(
      z.object({
        fiscalYearEnd: calendarDateSchema,
        value: engineDecimalSchema,
      }),
    )
    .min(DERIVED_MIN_REVENUE_YEARS)
    .max(DERIVED_MAX_REVENUE_YEARS),
});

export type DerivedAssumptions = z.infer<typeof derivedAssumptionsSchema>;

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
      readonly sensitivity: SensitivitySpec;
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

  const initialGrowth = latest
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

  const periods: PeriodAssumption[] = Array.from(
    { length: DERIVED_EXPLICIT_YEARS },
    (_, index) => {
      const year = index + 1;

      return {
        periodIndex: year,
        periodEnd: subtractCalendarYears(input.baseFiscalYearEnd, -year),
        revenueGrowth: formatDecimal(
          fade(initialGrowth, riskFree, year),
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

  return {
    status: "derived",
    initialGrowth: formatDecimal(initialGrowth, "initialGrowth"),
    periods,
    terminal: {
      growth: formatDecimal(riskFree, "terminal.growth"),
      ebitMargin: margin,
      taxRate: formatDecimal(marginalTax, "terminal.taxRate"),
      wacc: formatDecimal(terminalWacc, "terminal.wacc"),
      returnOnCapital: formatDecimal(terminalWacc, "terminal.returnOnCapital"),
    },
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
}): string[] {
  const mismatches: string[] = [];
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

  const rebuilt = deriveAssumptions({
    derivation: input.derivation,
    baseFiscalYearEnd: input.baseRevenue.asOf,
    normalization: input.normalization,
    costOfCapital: input.costOfCapital,
  });

  if (rebuilt.status === "unavailable") {
    return [...mismatches, "derivedAssumptions"];
  }

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
