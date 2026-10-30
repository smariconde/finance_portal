import {
  createDecimalOperations,
  HUNDRED,
  ONE,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { DivergenceViews } from "./divergence-views";
import type { FiscalEndpoint, FiscalEndpointPair } from "./fiscal-endpoints";

/**
 * Explains why the views disagree. Per endpoint it checks that diluted EPS is
 * its numerator over the reported diluted shares, and how far diluted sits
 * above basic. Across the pair it splits the difference between the aggregate
 * and per-share gaps into the share effect on earnings and on value.
 */
export const DILUTION_BRIDGE_VERSION = "dilution-bridge-1.0.0";

/** Reported EPS is rounded to the cent: half a cent is its rounding bound. */
const EPS_HALF_CENT = "0.005";

/**
 * Half the last printed unit of a reported amount. XBRL keeps no scale here,
 * so it is read from the trailing zeros: 132170000000 was printed in a unit of
 * at most 10,000,000. When the last printed digit is itself a zero this
 * overstates the unit, which only widens the bound.
 */
export function halfPrintedUnit(value: string): string {
  const digits = value.replace(/^-/u, "");
  const [whole, fraction] = digits.split(".");
  if (fraction !== undefined) return `0.${"0".repeat(fraction.length)}5`;
  const zeros = whole!.length - whole!.replace(/0+$/u, "").length;
  return zeros === 0 ? "0.5" : `5${"0".repeat(zeros - 1)}`;
}

const decimal = createDecimalOperations((code, message) => {
  const error = new Error(message);
  error.name = code;
  return error;
});

export type EndpointBridgeReason =
  "split_basis_unreconciled" | "missing_input" | "non_positive_input";

export type EndpointBridge = {
  readonly fiscalYearEnd: string;
  /** `(diluted / basic − 1) × 100`: the weight of dilutive securities. */
  readonly dilutivePct: string | null;
  readonly numeratorBasis:
    "net_income_available_to_common_diluted" | "net_income" | null;
  /** Numerator over diluted EPS. */
  readonly impliedDilutedShares: string | null;
  /** `(implied / reported − 1) × 100`. */
  readonly residualPct: string | null;
  /**
   * What printed rounding can explain, in percent: half a cent over |EPS| plus
   * half the printed unit of the numerator and of the diluted shares over each.
   */
  readonly roundingBoundPct: string | null;
  /**
   * `|residual| <= rounding bound`. False is named, not refused: continuing
   * operations EPS over total income, two-class allocations or a preferred
   * dividend the numerator misses all land here.
   */
  readonly reconciled: boolean | null;
  readonly reason: EndpointBridgeReason | null;
};

export type DilutionBridge = {
  readonly version: typeof DILUTION_BRIDGE_VERSION;
  readonly latest: EndpointBridge | null;
  readonly earlier: EndpointBridge | null;
  /** `net_income_cagr_pct − diluted_eps_cagr_pct`. */
  readonly earningsShareEffectPp: string | null;
  /** `market_cap_cagr_pct − price_cagr_pct`, the opposite of the bias. */
  readonly valueShareEffectPp: string | null;
  /**
   * `aggregate_gap_pp − per_share_gap_pp`, which equals exactly the earnings
   * effect minus the value effect.
   */
  readonly viewGapDifferencePp: string | null;
};

function parse(value: string | null | undefined, path: string): Dec | null {
  return value === null || value === undefined
    ? null
    : decimal.parseDecimal(value, path);
}

const format = (value: Dec, path: string) => decimal.formatDecimal(value, path);

function endpointBridge(point: FiscalEndpoint): EndpointBridge {
  const empty = {
    fiscalYearEnd: point.fiscalYearEnd,
    dilutivePct: null,
    numeratorBasis: null,
    impliedDilutedShares: null,
    residualPct: null,
    roundingBoundPct: null,
    reconciled: null,
  } as const;
  if (point.splitBasis.reason !== null)
    return { ...empty, reason: "split_basis_unreconciled" };

  const diluted = parse(point.splitBasis.adjustedDilutedShares, "diluted");
  const basic = parse(point.splitBasis.adjustedBasicShares, "basic");
  const dilutivePct =
    diluted !== null &&
    basic !== null &&
    diluted.greaterThan(ZERO) &&
    basic.greaterThan(ZERO)
      ? format(
          decimal.divide(diluted, basic, "dilutive").minus(ONE).times(HUNDRED),
          "dilutivePct",
        )
      : null;

  const numeratorBasis =
    point.dilutedNumerator !== null
      ? ("net_income_available_to_common_diluted" as const)
      : point.netIncome !== null
        ? ("net_income" as const)
        : null;
  const numerator = parse(
    point.dilutedNumerator?.value ?? point.netIncome?.value,
    "numerator",
  );
  const eps = parse(point.splitBasis.adjustedEps, "eps");
  if (numerator === null || eps === null || diluted === null)
    return { ...empty, dilutivePct, numeratorBasis, reason: "missing_input" };
  // A loss gives positive implied shares too, but a sign mismatch or zero has
  // no share count to compare.
  if (
    eps.isZero() ||
    numerator.isZero() ||
    !diluted.greaterThan(ZERO) ||
    eps.isNegative() !== numerator.isNegative()
  )
    return {
      ...empty,
      dilutivePct,
      numeratorBasis,
      reason: "non_positive_input",
    };

  const implied = decimal.divide(numerator, eps, "impliedShares");
  const residual = decimal
    .divide(implied, diluted, "residual")
    .minus(ONE)
    .times(HUNDRED);
  const relative = (half: string, of: Dec, path: string) =>
    decimal.divide(decimal.parseDecimal(half, path), of.abs(), path);
  const numeratorText = point.dilutedNumerator?.value ?? point.netIncome!.value;
  const bound = relative(EPS_HALF_CENT, eps, "bound.eps")
    .plus(
      relative(halfPrintedUnit(numeratorText), numerator, "bound.numerator"),
    )
    .plus(
      relative(
        halfPrintedUnit(point.splitBasis.adjustedDilutedShares!),
        diluted,
        "bound.shares",
      ),
    )
    .times(HUNDRED);
  return {
    fiscalYearEnd: point.fiscalYearEnd,
    dilutivePct,
    numeratorBasis,
    impliedDilutedShares: format(implied, "impliedShares"),
    residualPct: format(residual, "residualPct"),
    roundingBoundPct: format(bound, "roundingBoundPct"),
    reconciled: residual.abs().lessThanOrEqualTo(bound),
    reason: null,
  };
}

function minus(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  return format(
    decimal
      .parseDecimal(left, "left")
      .minus(decimal.parseDecimal(right, "right")),
    "difference",
  );
}

export function computeDilutionBridge(
  pair: FiscalEndpointPair,
  views: DivergenceViews,
): DilutionBridge {
  return {
    version: DILUTION_BRIDGE_VERSION,
    latest: pair.latest === null ? null : endpointBridge(pair.latest),
    earlier: pair.earlier === null ? null : endpointBridge(pair.earlier),
    earningsShareEffectPp: minus(
      views.growth.netIncome.value,
      views.growth.dilutedEps.value,
    ),
    valueShareEffectPp: minus(
      views.growth.marketCap.value,
      views.growth.price.value,
    ),
    viewGapDifferencePp: minus(views.aggregate.gapPp, views.perShare.gapPp),
  };
}
