import {
  createDecimalOperations,
  HUNDRED,
  ONE,
  ZERO,
  type Dec,
} from "@/modules/numeric/domain/decimal-policy";

import type { FiscalEndpoint, FiscalEndpointPair } from "./fiscal-endpoints";

/**
 * The three divergence views of `03_DATA_AND_PROVENANCE.md` over one aligned
 * fiscal pair. Every growth rate is a CAGR between two strictly positive
 * endpoints; anything else is a named category or reason, never a percentage.
 */
export const DIVERGENCE_VIEWS_VERSION = "divergence-views-1.1.0";

/**
 * A point whose share-count bias exceeds this, in absolute value, is marked:
 * about 2 % of the shares bought back or issued per year (owner's decision).
 */
export const SHARE_COUNT_BIAS_TOLERANCE_PP = "2";

const DAYS_PER_YEAR = "365.2425";
const DAY_MS = 86_400_000;

const decimal = createDecimalOperations((code, message) => {
  const error = new Error(message);
  error.name = code;
  return error;
});

export type GrowthReason =
  | "no_comparable_year"
  | "missing_input"
  | "split_basis_unreconciled"
  | "non_positive_endpoint";

export type Growth =
  | { readonly value: string; readonly reason: null }
  | { readonly value: null; readonly reason: GrowthReason };

/**
 * A view's earnings side decides its category. Turning positive, turning
 * non-positive and staying non-positive are different stories and none of
 * them has a growth rate.
 */
export type ViewCategory =
  | "comparable"
  | "earnings_turned_positive"
  | "earnings_turned_non_positive"
  | "earnings_non_positive"
  | "unavailable";

export type DivergenceView = {
  readonly category: ViewCategory;
  /** Value side: market cap or price. */
  readonly x: Growth;
  /** Earnings side: diluted EPS or net income. */
  readonly y: Growth;
  readonly gapPp: string | null;
};

/**
 * Both endpoints use the same share count, or market cap has no growth: a
 * close count at one end and an average at the other would invent a buyback.
 * The average diluted count is the fallback when the balance sheet carries no
 * undimensioned close count (owner's decision); it is named on the point.
 */
export type MarketCapBasis =
  "shares_outstanding_at_close" | "weighted_diluted_shares";

export type FundamentalView = DivergenceView & {
  /** `price_cagr_pct − market_cap_cagr_pct`: buybacks positive, dilution negative. */
  readonly shareCountBiasPp: string | null;
  /** `fundamental_gap_pp − share_count_bias_pp`, equal to the per-share gap. */
  readonly perShareGapPp: string | null;
  /** `|share_count_bias_pp| > SHARE_COUNT_BIAS_TOLERANCE_PP`; null without a bias. */
  readonly biasMarked: boolean | null;
};

export type DivergenceViews = {
  readonly version: typeof DIVERGENCE_VIEWS_VERSION;
  readonly horizonYears: 2 | 5;
  /** `days / 365.2425` between the two fiscal closes. */
  readonly years: string | null;
  readonly marketCapBasis: MarketCapBasis | null;
  /**
   * The level at each fiscal close, USD, on `marketCapBasis`; both `null` when
   * no basis closes. Since `1.1.0`: it is what the size filter reads.
   */
  readonly marketCap: {
    readonly earlier: string | null;
    readonly latest: string | null;
  };
  readonly growth: {
    readonly marketCap: Growth;
    readonly netIncome: Growth;
    readonly price: Growth;
    readonly dilutedEps: Growth;
    readonly dilutedShares: Growth;
  };
  /** Market cap against diluted EPS: the owner's main view (ADR 0016). */
  readonly fundamental: FundamentalView;
  /** Market cap against net income: both totals. */
  readonly aggregate: DivergenceView;
  /** Price against diluted EPS: both per share. */
  readonly perShare: DivergenceView;
};

type Side = {
  readonly value: Dec | null;
  readonly reason: GrowthReason | null;
};

const absent = (reason: GrowthReason): Side => ({ value: null, reason });

function read(value: string | null, path: string): Side {
  return value === null
    ? absent("missing_input")
    : { value: decimal.parseDecimal(value, path), reason: null };
}

/** Per-share values exist only on a reconciled split basis. */
function perShare(
  point: FiscalEndpoint,
  pick: (point: FiscalEndpoint) => string | null,
  path: string,
): Side {
  if (point.splitBasis.reason !== null)
    return absent("split_basis_unreconciled");
  return read(pick(point), path);
}

function closeMarketCap(point: FiscalEndpoint): Side {
  if (point.marketCap !== null) return read(point.marketCap, "marketCap");
  return absent(
    point.missing.includes("market_cap_split_basis_unreconciled")
      ? "split_basis_unreconciled"
      : "missing_input",
  );
}

/** Close × average diluted shares, on the same reconciled split basis. */
function dilutedMarketCap(point: FiscalEndpoint): Side {
  if (point.missing.includes("multiple_share_classes_unreconciled"))
    return absent("missing_input");
  if (point.splitBasis.reason !== null)
    return absent("split_basis_unreconciled");
  const close = point.splitBasis.adjustedPrice;
  const shares = point.splitBasis.adjustedDilutedShares;
  if (
    close === null ||
    shares === null ||
    point.price?.currency !== "USD" ||
    point.dilutedShares?.unit !== "shares" ||
    point.dilutedShares.currency !== null
  )
    return absent("missing_input");
  const value = decimal
    .parseDecimal(close, "price")
    .times(decimal.parseDecimal(shares, "dilutedShares"));
  return { value, reason: null };
}

function marketCapPair(
  earlier: FiscalEndpoint,
  latest: FiscalEndpoint,
): {
  readonly basis: MarketCapBasis | null;
  readonly sides: readonly [Side, Side];
} {
  const close = [closeMarketCap(earlier), closeMarketCap(latest)] as const;
  if (close[0].reason === null && close[1].reason === null)
    return { basis: "shares_outstanding_at_close", sides: close };
  const diluted = [
    dilutedMarketCap(earlier),
    dilutedMarketCap(latest),
  ] as const;
  if (diluted[0].reason === null && diluted[1].reason === null)
    return { basis: "weighted_diluted_shares", sides: diluted };
  return { basis: null, sides: close };
}

const sides = {
  netIncome: (point: FiscalEndpoint) =>
    read(point.netIncome?.value ?? null, "netIncome"),
  price: (point: FiscalEndpoint) =>
    perShare(point, (p) => p.splitBasis.adjustedPrice, "price"),
  dilutedEps: (point: FiscalEndpoint) =>
    perShare(point, (p) => p.splitBasis.adjustedEps, "dilutedEps"),
  dilutedShares: (point: FiscalEndpoint) =>
    perShare(point, (p) => p.splitBasis.adjustedDilutedShares, "dilutedShares"),
} as const;

function level(
  basis: MarketCapBasis | null,
  side: Side,
  path: string,
): string | null {
  return basis === null || side.value === null
    ? null
    : decimal.formatDecimal(side.value, path);
}

function cagr(earlier: Side, latest: Side, years: Dec): Growth {
  const reason = earlier.reason ?? latest.reason;
  if (reason !== null) return { value: null, reason };
  if (!earlier.value!.greaterThan(ZERO) || !latest.value!.greaterThan(ZERO))
    return { value: null, reason: "non_positive_endpoint" };
  const ratio = decimal.divide(latest.value!, earlier.value!, "cagr.ratio");
  const rate = ratio.pow(decimal.divide(ONE, years, "cagr.exponent"));
  return {
    value: decimal.formatDecimal(rate.minus(ONE).times(HUNDRED), "cagr"),
    reason: null,
  };
}

function difference(left: Growth, right: Growth): string | null {
  if (left.value === null || right.value === null) return null;
  return decimal.formatDecimal(
    decimal
      .parseDecimal(left.value, "gap.left")
      .minus(decimal.parseDecimal(right.value, "gap.right")),
    "gap",
  );
}

function view(
  x: Growth,
  y: Growth,
  [earlier, latest]: readonly [Side, Side],
): DivergenceView {
  let kind: ViewCategory = "unavailable";
  if (earlier.value !== null && latest.value !== null) {
    const before = earlier.value.greaterThan(ZERO);
    const after = latest.value.greaterThan(ZERO);
    if (before && after) kind = x.value === null ? "unavailable" : "comparable";
    else if (after) kind = "earnings_turned_positive";
    else if (before) kind = "earnings_turned_non_positive";
    else kind = "earnings_non_positive";
  }
  return {
    category: kind,
    x,
    y,
    gapPp: kind === "comparable" ? difference(y, x) : null,
  };
}

const NO_YEAR: Growth = { value: null, reason: "no_comparable_year" };

/**
 * Compute every view the pair supports. A view may be valid while another is
 * not: net income can be positive while a split leaves EPS unreconciled.
 */
export function computeDivergenceViews(
  pair: FiscalEndpointPair,
): DivergenceViews {
  const { latest, earlier } = pair;
  if (latest === null || earlier === null) {
    const unavailable: DivergenceView = {
      category: "unavailable",
      x: NO_YEAR,
      y: NO_YEAR,
      gapPp: null,
    };
    return {
      version: DIVERGENCE_VIEWS_VERSION,
      horizonYears: pair.horizonYears,
      years: null,
      marketCapBasis: null,
      marketCap: { earlier: null, latest: null },
      growth: {
        marketCap: NO_YEAR,
        netIncome: NO_YEAR,
        price: NO_YEAR,
        dilutedEps: NO_YEAR,
        dilutedShares: NO_YEAR,
      },
      fundamental: {
        ...unavailable,
        shareCountBiasPp: null,
        perShareGapPp: null,
        biasMarked: null,
      },
      aggregate: unavailable,
      perShare: unavailable,
    };
  }

  const days =
    (Date.parse(`${latest.fiscalYearEnd}T00:00:00.000Z`) -
      Date.parse(`${earlier.fiscalYearEnd}T00:00:00.000Z`)) /
    DAY_MS;
  const years = decimal.divide(
    decimal.parseDecimal(String(days), "days"),
    decimal.parseDecimal(DAYS_PER_YEAR, "daysPerYear"),
    "years",
  );
  const pairOf = (side: (point: FiscalEndpoint) => Side) =>
    [side(earlier), side(latest)] as const;
  const { basis, sides: marketCap } = marketCapPair(earlier, latest);
  const netIncome = pairOf(sides.netIncome);
  const price = pairOf(sides.price);
  const eps = pairOf(sides.dilutedEps);
  const shares = pairOf(sides.dilutedShares);
  const growth = {
    marketCap: cagr(...marketCap, years),
    netIncome: cagr(...netIncome, years),
    price: cagr(...price, years),
    dilutedEps: cagr(...eps, years),
    dilutedShares: cagr(...shares, years),
  };

  const fundamental = view(growth.marketCap, growth.dilutedEps, eps);
  const bias = difference(growth.price, growth.marketCap);

  return {
    version: DIVERGENCE_VIEWS_VERSION,
    horizonYears: pair.horizonYears,
    years: decimal.formatDecimal(years, "years"),
    marketCapBasis: basis,
    marketCap: {
      earlier: level(basis, marketCap[0], "marketCap.earlier"),
      latest: level(basis, marketCap[1], "marketCap.latest"),
    },
    growth,
    fundamental: {
      ...fundamental,
      shareCountBiasPp: bias,
      perShareGapPp:
        fundamental.gapPp === null || bias === null
          ? null
          : decimal.formatDecimal(
              decimal
                .parseDecimal(fundamental.gapPp, "gap")
                .minus(decimal.parseDecimal(bias, "bias")),
              "perShareGap",
            ),
      biasMarked:
        bias === null
          ? null
          : decimal
              .parseDecimal(bias, "bias")
              .abs()
              .greaterThan(
                decimal.parseDecimal(
                  SHARE_COUNT_BIAS_TOLERANCE_PP,
                  "tolerance",
                ),
              ),
    },
    aggregate: view(growth.marketCap, growth.netIncome, netIncome),
    perShare: view(growth.price, growth.dilutedEps, eps),
  };
}
