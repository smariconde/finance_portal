import type { PriceEvent } from "@/modules/prices/domain/daily-close";

import { DERIVED_EXPLICIT_YEARS, fade } from "./derived-assumptions";
import {
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import { computeFcff, type FcffOverride } from "./fcff";
import { ValuationPolicyError } from "./valuation-error";
import type { ValuationInput } from "./valuation-input";
import type { ValuationRun } from "./valuation-run";

/**
 * Precio de mercado y expectativas implícitas (`F6-09`,
 * [ADR 0048](../../../../docs/architecture/adr/0048-market-price-implied-expectations.md)).
 *
 * Dos lecturas sobre una corrida ya registrada, que nunca la modifican ni
 * entran en sus hashes:
 *
 * 1. `market-price-comparison-1.0.0`: el cierre crudo guardado **al `as_of` de
 *    la corrida** contra su valor por acción. Mismo día, misma moneda, misma
 *    base de acciones: si hubo un split entre el conteo de acciones y el
 *    cierre, no se compara.
 * 2. `market-implied-1.0.0`: un DCF inverso. Para cada driver, el valor que
 *    hace que el motor devuelva el precio, **moviendo sólo ese driver** y
 *    dejando el resto de la corrida igual. No es una corrida: no pasa por los
 *    policy checks y no se registra. Es la pregunta «¿qué tiene que pasar para
 *    que este precio sea razonable?», con el mismo motor que dio el valor.
 *
 * La resolución es por bisección con un número fijo de pasos —determinista,
 * sin tolerancias que dependan del punto de partida— sobre un intervalo
 * declarado por driver. Si el precio queda fuera de lo que el driver alcanza
 * dentro del intervalo, se dice de qué lado y con qué valor en el borde:
 * nunca se extrapola.
 */
export const MARKET_PRICE_COMPARISON_VERSION = "market-price-comparison-1.0.0";
export const MARKET_IMPLIED_VERSION = "market-implied-1.0.0";

/** Pasos de bisección: con el intervalo más ancho (5) dejan < 1e-12. */
export const MARKET_IMPLIED_ITERATIONS = 48;
/** Escala con la que se publica un driver implícito: 0,0001 % de tasa. */
export const MARKET_IMPLIED_SCALE = 6;

export type MarketClose = {
  readonly marketDate: string;
  readonly close: string;
  readonly currency: string;
};

export type MarketPriceComparisonUnavailableReason =
  /** La corrida fue rechazada: no hay valor por acción. */
  | "no_value_per_share"
  /** No hay cierre guardado en el día del `as_of`. */
  | "no_close_at_as_of"
  | "currency_mismatch"
  /** El cierre o el valor no son positivos: la proporción no significa nada. */
  | "non_positive_close"
  | "non_positive_value"
  /**
   * Un split entre la base de acciones de la corrida y el cierre: el precio
   * y el valor por acción hablan de acciones distintas.
   */
  | "split_after_share_basis";

export type MarketPriceComparison =
  | {
      readonly status: "compared";
      readonly version: typeof MARKET_PRICE_COMPARISON_VERSION;
      readonly price: MarketClose;
      readonly valuePerShare: string;
      /** `valor ÷ precio − 1`: negativo cuando el precio supera al valor. */
      readonly valueToPrice: string;
      /** `precio ÷ valor`: cuántas veces el valor paga el mercado. */
      readonly priceToValue: string;
    }
  | {
      readonly status: "unavailable";
      readonly version: typeof MARKET_PRICE_COMPARISON_VERSION;
      readonly reason: MarketPriceComparisonUnavailableReason;
      readonly price: MarketClose | null;
    };

/**
 * La fecha desde la que la corrida cuenta acciones: la más vieja entre el
 * conteo de carátula y el cierre del ejercicio base, que es de donde salen
 * las unidades no consolidadas de la nota de compensación.
 */
export function shareBasisDate(input: ValuationInput): string {
  const cover = input.employeeEquity.sharesOutstanding.asOf;
  const base = input.baseRevenue.asOf;

  return cover < base ? cover : base;
}

export function compareWithMarketPrice(input: {
  readonly run: Pick<ValuationRun, "asOf" | "currency" | "input" | "result">;
  readonly closes: readonly MarketClose[];
  readonly events: readonly Pick<PriceEvent, "eventType" | "effectiveOn">[];
}): MarketPriceComparison {
  const { run } = input;
  const price =
    input.closes.find((close) => close.marketDate === run.asOf) ?? null;
  const unavailable = (
    reason: MarketPriceComparisonUnavailableReason,
  ): MarketPriceComparison => ({
    status: "unavailable",
    version: MARKET_PRICE_COMPARISON_VERSION,
    reason,
    price,
  });

  if (run.result === null) {
    return unavailable("no_value_per_share");
  }

  if (price === null) {
    return unavailable("no_close_at_as_of");
  }

  if (price.currency !== run.currency) {
    return unavailable("currency_mismatch");
  }

  const basis = shareBasisDate(run.input);

  if (
    input.events.some(
      (event) =>
        event.eventType === "split" &&
        event.effectiveOn > basis &&
        event.effectiveOn <= price.marketDate,
    )
  ) {
    return unavailable("split_after_share_basis");
  }

  const close = parseDecimal(price.close, "price.close");
  const value = parseDecimal(run.result.valuePerShare, "valuePerShare");

  if (!close.greaterThan(ZERO)) {
    return unavailable("non_positive_close");
  }

  if (!value.greaterThan(ZERO)) {
    return unavailable("non_positive_value");
  }

  return {
    status: "compared",
    version: MARKET_PRICE_COMPARISON_VERSION,
    price,
    valuePerShare: run.result.valuePerShare,
    valueToPrice: formatDecimal(
      divide(value, close, "price.close").minus(ONE),
      "valueToPrice",
    ),
    priceToValue: formatDecimal(
      divide(close, value, "valuePerShare"),
      "priceToValue",
    ),
  };
}

export const MARKET_IMPLIED_DRIVERS = [
  /** Crecimiento de ventas de los años 1–5, con la convergencia de la regla. */
  "revenue_growth",
  /** Margen EBIT de todos los períodos y del terminal. */
  "ebit_margin",
  /** ROIC terminal: cuánto se reinvierte para sostener el `g` perpetuo. */
  "terminal_return_on_capital",
  /** Una sola tasa para todos los períodos y el terminal: la TIR del precio. */
  "discount_rate",
] as const;

export type MarketImpliedDriver = (typeof MARKET_IMPLIED_DRIVERS)[number];

export type MarketImpliedReading =
  | {
      readonly driver: MarketImpliedDriver;
      readonly status: "solved";
      /** Lo que la corrida supuso para este driver. */
      readonly runValue: string;
      /** Lo que el precio exige, con todo lo demás igual. */
      readonly implied: string;
      readonly bounds: { readonly lower: string; readonly upper: string };
    }
  | {
      readonly driver: MarketImpliedDriver;
      /**
       * El precio queda fuera de lo que el driver alcanza en su intervalo.
       * `price_above_range`: ni el borde más favorable llega al precio.
       */
      readonly status: "price_above_range" | "price_below_range";
      readonly runValue: string;
      readonly bounds: { readonly lower: string; readonly upper: string };
      /** El valor por acción más cercano al precio que el intervalo permite. */
      readonly closestValuePerShare: string;
    }
  | {
      readonly driver: MarketImpliedDriver;
      readonly status: "unavailable";
      readonly reason:
        /** La forma de los períodos no es la de la regla derivada. */
        | "growth_shape_unsupported"
        /** El motor rechazó el snapshot en un borde del intervalo. */
        | "engine_rejected";
      readonly runValue: string | null;
    };

export type MarketImplied =
  | {
      readonly status: "computed";
      readonly version: typeof MARKET_IMPLIED_VERSION;
      readonly price: string;
      readonly readings: readonly MarketImpliedReading[];
    }
  | {
      readonly status: "unavailable";
      readonly version: typeof MARKET_IMPLIED_VERSION;
      readonly reason: "price_not_compared";
    };

type DriverPlan = {
  readonly runValue: string;
  readonly lower: Dec;
  readonly upper: Dec;
  readonly valueAt: (x: Dec) => Dec;
};

const GROWTH_BOUNDS = { lower: "-0.3", upper: "0.6" } as const;
const MARGIN_BOUNDS = { lower: "0", upper: "0.95" } as const;
const ROIC_UPPER = "5";
const DISCOUNT_RATE_UPPER = "0.3";
/** Igual que el colchón del check `wacc > g`: por debajo el terminal explota. */
const DISCOUNT_RATE_BUFFER = "0.005";

function valuePerShare(input: ValuationInput, override: FcffOverride): Dec {
  return parseDecimal(
    computeFcff(input, override).valuePerShare,
    "valuePerShare",
  );
}

function withGrowth(input: ValuationInput, growth: Dec): ValuationInput {
  const terminalGrowth = parseDecimal(input.terminal.growth, "terminal.growth");

  return {
    ...input,
    periods: input.periods.map((period, index) => ({
      ...period,
      revenueGrowth: formatDecimal(
        fade(growth, terminalGrowth, index + 1),
        `periods.${index}.revenueGrowth`,
      ),
    })),
  };
}

/** La forma de la regla derivada: diez años, los cinco primeros iguales. */
function hasDerivedGrowthShape(input: ValuationInput): boolean {
  if (
    input.derivedAssumptions === undefined ||
    input.periods.length !== DERIVED_EXPLICIT_YEARS
  ) {
    return false;
  }

  const start = parseDecimal(input.periods[0]!.revenueGrowth, "growth");

  return withGrowth(input, start).periods.every((period, index) =>
    parseDecimal(period.revenueGrowth, "growth").eq(
      parseDecimal(input.periods[index]!.revenueGrowth, "growth"),
    ),
  );
}

function planFor(
  driver: MarketImpliedDriver,
  input: ValuationInput,
): DriverPlan | "growth_shape_unsupported" {
  const terminalGrowth = parseDecimal(input.terminal.growth, "terminal.growth");

  switch (driver) {
    case "revenue_growth":
      if (!hasDerivedGrowthShape(input)) {
        return "growth_shape_unsupported";
      }

      return {
        runValue: input.periods[0]!.revenueGrowth,
        lower: parseDecimal(GROWTH_BOUNDS.lower, "bounds"),
        upper: parseDecimal(GROWTH_BOUNDS.upper, "bounds"),
        valueAt: (growth) => valuePerShare(withGrowth(input, growth), {}),
      };
    case "ebit_margin":
      return {
        runValue: input.terminal.ebitMargin,
        lower: parseDecimal(MARGIN_BOUNDS.lower, "bounds"),
        upper: parseDecimal(MARGIN_BOUNDS.upper, "bounds"),
        valueAt: (margin) =>
          valuePerShare(input, {
            ebitMargin: formatDecimal(margin, "ebitMargin"),
          }),
      };
    case "terminal_return_on_capital": {
      // Con ROIC = g se reinvierte todo el NOPAT terminal; por debajo, más.
      const floor = terminalGrowth.greaterThan(ZERO) ? terminalGrowth : ZERO;

      return {
        runValue: input.terminal.returnOnCapital,
        lower: floor.plus("0.001"),
        upper: parseDecimal(ROIC_UPPER, "bounds"),
        valueAt: (roic) =>
          valuePerShare(
            {
              ...input,
              terminal: {
                ...input.terminal,
                returnOnCapital: formatDecimal(roic, "returnOnCapital"),
              },
            },
            {},
          ),
      };
    }
    case "discount_rate":
      return {
        runValue: input.periods[0]!.wacc,
        lower: terminalGrowth.plus(DISCOUNT_RATE_BUFFER),
        upper: parseDecimal(DISCOUNT_RATE_UPPER, "bounds"),
        valueAt: (rate) =>
          valuePerShare(input, { wacc: formatDecimal(rate, "wacc") }),
      };
  }
}

function solve(
  driver: MarketImpliedDriver,
  input: ValuationInput,
  price: Dec,
): MarketImpliedReading {
  const plan = planFor(driver, input);

  if (plan === "growth_shape_unsupported") {
    return {
      driver,
      status: "unavailable",
      reason: plan,
      runValue: null,
    };
  }

  const bounds = {
    lower: formatDecimal(plan.lower, "bounds.lower"),
    upper: formatDecimal(plan.upper, "bounds.upper"),
  };
  let atLower: Dec;
  let atUpper: Dec;

  try {
    atLower = plan.valueAt(plan.lower).minus(price);
    atUpper = plan.valueAt(plan.upper).minus(price);
  } catch (error) {
    if (error instanceof ValuationPolicyError) {
      return {
        driver,
        status: "unavailable",
        reason: "engine_rejected",
        runValue: plan.runValue,
      };
    }

    throw error;
  }

  if (atLower.isZero() || atUpper.isZero()) {
    return {
      driver,
      status: "solved",
      runValue: plan.runValue,
      implied: formatDecimal(
        (atLower.isZero() ? plan.lower : plan.upper).toDecimalPlaces(
          MARKET_IMPLIED_SCALE,
        ),
        "implied",
      ),
      bounds,
    };
  }

  if (atLower.isNegative() === atUpper.isNegative()) {
    const closest = atLower.abs().lessThan(atUpper.abs()) ? atLower : atUpper;

    return {
      driver,
      status: atLower.isNegative() ? "price_above_range" : "price_below_range",
      runValue: plan.runValue,
      bounds,
      closestValuePerShare: formatDecimal(
        closest.plus(price),
        "closestValuePerShare",
      ),
    };
  }

  let lower = plan.lower;
  let upper = plan.upper;
  const lowerNegative = atLower.isNegative();

  for (let step = 0; step < MARKET_IMPLIED_ITERATIONS; step += 1) {
    const middle = lower.plus(upper).dividedBy(2);
    const gap = plan.valueAt(middle).minus(price);

    if (gap.isZero()) {
      lower = middle;
      upper = middle;
      break;
    }

    if (gap.isNegative() === lowerNegative) {
      lower = middle;
    } else {
      upper = middle;
    }
  }

  return {
    driver,
    status: "solved",
    runValue: plan.runValue,
    implied: formatDecimal(
      lower.plus(upper).dividedBy(2).toDecimalPlaces(MARKET_IMPLIED_SCALE),
      "implied",
    ),
    bounds,
  };
}

/**
 * El DCF inverso sobre una corrida con precio comparado. Cada driver se
 * resuelve solo: combinarlos es una opinión sobre cuál se mueve, y eso es de
 * quien lee, no de la regla.
 */
export function marketImpliedExpectations(input: {
  readonly run: Pick<ValuationRun, "input">;
  readonly comparison: MarketPriceComparison;
}): MarketImplied {
  if (input.comparison.status !== "compared") {
    return {
      status: "unavailable",
      version: MARKET_IMPLIED_VERSION,
      reason: "price_not_compared",
    };
  }

  const price = parseDecimal(input.comparison.price.close, "price.close");

  return {
    status: "computed",
    version: MARKET_IMPLIED_VERSION,
    price: input.comparison.price.close,
    readings: MARKET_IMPLIED_DRIVERS.map((driver) =>
      solve(driver, input.run.input, price),
    ),
  };
}

/**
 * Contra qué leer cada driver implícito: lo que la propia empresa ya mostró
 * en lo guardado, sin una fuente nueva. El crecimiento histórico se mide sobre
 * la historia de ventas que la corrida congeló, en dos ventanas —la completa
 * y los últimos tres ejercicios— porque una sola ventana depende de su punta.
 */
export type MarketImpliedContext = {
  readonly historicalGrowth: readonly {
    readonly years: number;
    readonly fromFiscalYearEnd: string;
    readonly cagr: string;
  }[];
  readonly baseEbitMargin: string | null;
  readonly baseReturnOnCapital: string | null;
  readonly costOfEquity: string;
  readonly wacc: string;
  readonly terminalWacc: string;
};

const RECENT_GROWTH_YEARS = 3;

export function marketImpliedContext(
  input: ValuationInput,
): MarketImpliedContext {
  const history = input.derivedAssumptions?.revenueHistory ?? [];
  const latest = history[0];
  const windows = [
    ...new Set([history.length - 1, RECENT_GROWTH_YEARS]),
  ].filter((years) => years >= 1 && years < history.length);
  const historicalGrowth =
    latest === undefined
      ? []
      : windows.flatMap((years) => {
          const oldest = history[years]!;
          const from = parseDecimal(oldest.value, `revenueHistory.${years}`);
          const to = parseDecimal(latest.value, "revenueHistory.0");

          if (!from.greaterThan(ZERO) || !to.greaterThan(ZERO)) {
            return [];
          }

          return [
            {
              years,
              fromFiscalYearEnd: oldest.fiscalYearEnd,
              cagr: formatDecimal(
                to.dividedBy(from).pow(ONE.dividedBy(years)).minus(ONE),
                "historicalGrowth",
              ),
            },
          ];
        });
  const { derived } = input.costOfCapital;

  return {
    historicalGrowth,
    baseEbitMargin: input.normalization.base.ebitMarginAdjusted,
    baseReturnOnCapital: input.normalization.base.returnOnCapitalAdjusted,
    costOfEquity: derived.costOfEquity,
    wacc: derived.wacc,
    terminalWacc: derived.terminalWacc,
  };
}
