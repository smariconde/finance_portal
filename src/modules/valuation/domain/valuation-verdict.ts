import {
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import type {
  MarketPriceComparison,
  MarketPriceComparisonUnavailableReason,
} from "./market-implied";
import type { ValuationResult } from "./valuation-run";

/**
 * Dónde cae el precio respecto del rango del modelo y cómo se llega del flujo
 * proyectado al valor por acción (`F6-17`). Son lecturas de una corrida ya
 * registrada: no la recalculan, no entran al snapshot y no mueven sus hashes.
 *
 * El veredicto es una **ubicación**, no una recomendación: dice si el precio
 * queda debajo del escenario pesimista, entre los escenarios o encima del
 * optimista. Las palabras «barata» o «cara» no existen acá.
 */
export const VALUATION_VERDICT_VERSION = "valuation-verdict-1.0.0";
export const VALUE_CHAIN_VERSION = "value-chain-1.0.0";

export type PriceZone =
  "below_bear" | "bear_to_base" | "base_to_bull" | "above_bull";

export type ValuationVerdict =
  | {
      readonly status: "placed";
      readonly version: typeof VALUATION_VERDICT_VERSION;
      readonly price: string;
      readonly marketDate: string;
      readonly value: string;
      readonly bear: string | null;
      readonly bull: string | null;
      readonly priceToValue: string;
      readonly relation: "below" | "equal" | "above";
      /** `null` sin escenarios: no hay rango donde ubicarlo. */
      readonly zone: PriceZone | null;
      /**
       * Posiciones de cada marca sobre una escala común, de 0 a 100. Son para
       * dibujar: la cifra exacta sigue escrita al lado.
       */
      readonly scale: {
        readonly price: number;
        readonly value: number;
        readonly bear: number | null;
        readonly bull: number | null;
      };
    }
  | {
      readonly status: "unplaced";
      readonly version: typeof VALUATION_VERDICT_VERSION;
      readonly reason: MarketPriceComparisonUnavailableReason;
    };

/** Margen a cada lado de la escala, como fracción del tramo dibujado. */
const SCALE_PADDING = "0.08";

function zoneOf(price: Dec, bear: Dec, base: Dec, bull: Dec): PriceZone {
  if (price.lessThan(bear)) return "below_bear";
  if (price.lessThanOrEqualTo(base)) return "bear_to_base";
  if (price.lessThanOrEqualTo(bull)) return "base_to_bull";
  return "above_bull";
}

export function valuationVerdict(input: {
  readonly comparison: MarketPriceComparison;
  readonly scenarios: ValuationResult["scenarios"];
}): ValuationVerdict {
  const { comparison } = input;

  if (comparison.status !== "compared") {
    return {
      status: "unplaced",
      version: VALUATION_VERDICT_VERSION,
      reason: comparison.reason,
    };
  }

  const price = parseDecimal(comparison.price.close, "verdict.price");
  const value = parseDecimal(comparison.valuePerShare, "verdict.value");
  const bear =
    input.scenarios === null
      ? null
      : parseDecimal(input.scenarios.bear.valuePerShare, "verdict.bear");
  const bull =
    input.scenarios === null
      ? null
      : parseDecimal(input.scenarios.bull.valuePerShare, "verdict.bull");

  const marks = [
    price,
    value,
    ...(bear === null ? [] : [bear]),
    ...(bull === null ? [] : [bull]),
  ];
  const low = marks.reduce((min, mark) => (mark.lessThan(min) ? mark : min));
  const high = marks.reduce((max, mark) =>
    mark.greaterThan(max) ? mark : max,
  );
  const padding = high.minus(low).times(SCALE_PADDING);
  const floor = low.minus(padding).lessThan(ZERO) ? ZERO : low.minus(padding);
  const span = high.plus(padding).minus(floor);
  const position = (mark: Dec): number =>
    span.isZero()
      ? 50
      : Number(mark.minus(floor).dividedBy(span).times(100).toFixed(1));

  return {
    status: "placed",
    version: VALUATION_VERDICT_VERSION,
    price: comparison.price.close,
    marketDate: comparison.price.marketDate,
    value: comparison.valuePerShare,
    bear: bear === null ? null : formatDecimal(bear, "verdict.bear"),
    bull: bull === null ? null : formatDecimal(bull, "verdict.bull"),
    priceToValue: comparison.priceToValue,
    relation: price.lessThan(value)
      ? "below"
      : price.equals(value)
        ? "equal"
        : "above",
    zone:
      bear === null || bull === null ? null : zoneOf(price, bear, value, bull),
    scale: {
      price: position(price),
      value: position(value),
      bear: bear === null ? null : position(bear),
      bull: bull === null ? null : position(bull),
    },
  };
}

export type ValueChain = {
  readonly version: typeof VALUE_CHAIN_VERSION;
  readonly explicitYears: number;
  readonly firstYear: {
    readonly revenue: string;
    readonly ebit: string;
    readonly fcff: string;
  };
  readonly lastYear: {
    readonly revenue: string;
    readonly ebit: string;
    readonly fcff: string;
  };
  /** Suma del valor presente de los años explícitos. */
  readonly explicitPresentValue: string;
  /** Valor presente del valor terminal. */
  readonly terminalPresentValue: string;
  readonly goingConcernValue: string;
  readonly failureProbability: string;
  readonly enterpriseValue: string;
  readonly bridge: ValuationResult["bridgeComponents"];
  readonly equityValue: string;
  readonly shareCount: string;
  readonly valuePerShare: string;
};

/** Del flujo proyectado al valor por acción, con los pasos del motor. */
export function valueChain(result: ValuationResult): ValueChain {
  const first = result.periods[0]!;
  const last = result.periods.at(-1)!;

  return {
    version: VALUE_CHAIN_VERSION,
    explicitYears: result.periods.length,
    firstYear: { revenue: first.revenue, ebit: first.ebit, fcff: first.fcff },
    lastYear: { revenue: last.revenue, ebit: last.ebit, fcff: last.fcff },
    explicitPresentValue: formatDecimal(
      sum(
        result.periods.map((period, index) =>
          parseDecimal(period.presentValue, `periods.${index}.presentValue`),
        ),
      ),
      "valueChain.explicitPresentValue",
    ),
    terminalPresentValue: result.terminal.presentValue,
    goingConcernValue: result.failureAdjustment.goingConcernValue,
    failureProbability: result.failureAdjustment.probability,
    enterpriseValue: result.enterpriseValue,
    bridge: result.bridgeComponents,
    equityValue: result.equityValue,
    shareCount: result.shareCount,
    valuePerShare: result.valuePerShare,
  };
}
