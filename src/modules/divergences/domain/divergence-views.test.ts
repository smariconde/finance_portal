import { describe, expect, it } from "vitest";

import {
  computeDivergenceViews,
  DIVERGENCE_VIEWS_VERSION,
} from "./divergence-views";
import {
  FISCAL_ENDPOINTS_VERSION,
  type FiscalEndpoint,
  type FiscalEndpointPair,
} from "./fiscal-endpoints";
import { FISCAL_SPLIT_BASIS_VERSION } from "./fiscal-split-basis";

type Values = {
  readonly fiscalYearEnd: string;
  readonly price: string | null;
  readonly shares: string | null;
  readonly eps: string | null;
  readonly netIncome: string | null;
  readonly dilutedShares?: string | null;
  readonly splitReason?: FiscalEndpoint["splitBasis"]["reason"];
  readonly missing?: readonly string[];
};

function point(values: Values): FiscalEndpoint {
  const splitReason = values.splitReason ?? null;
  const marketCap =
    values.price === null || values.shares === null || splitReason !== null
      ? null
      : String(Number(values.price) * Number(values.shares));
  return {
    fiscalYearEnd: values.fiscalYearEnd,
    price:
      values.price === null
        ? null
        : ({ currency: "USD" } as FiscalEndpoint["price"]),
    priceLagDays: 0,
    netIncome:
      values.netIncome === null
        ? null
        : ({ value: values.netIncome } as FiscalEndpoint["netIncome"]),
    dilutedEps: null,
    dilutedShares:
      (values.dilutedShares ?? values.shares) === null
        ? null
        : ({
            unit: "shares",
            currency: null,
          } as FiscalEndpoint["dilutedShares"]),
    sharesOutstanding: null,
    splitBasis: {
      version: FISCAL_SPLIT_BASIS_VERSION,
      priceFactor: "1",
      actionIds: [],
      adjustedPrice: values.price,
      adjustedEps: values.eps,
      adjustedDilutedShares: values.dilutedShares ?? values.shares,
      adjustedSharesOutstanding: values.shares,
      reason: splitReason,
    },
    marketCap,
    missing: [
      ...(values.missing ?? []),
      ...(splitReason !== null && values.price !== null
        ? [splitReason, "market_cap_split_basis_unreconciled"]
        : []),
    ],
  };
}

function pair(earlier: Values, latest: Values): FiscalEndpointPair {
  return {
    version: FISCAL_ENDPOINTS_VERSION,
    horizonYears: 2,
    actualYears: null,
    latest: point(latest),
    earlier: point(earlier),
    reason: null,
  };
}

const EARLIER: Values = {
  fiscalYearEnd: "2023-12-31",
  price: "100",
  shares: "1000",
  eps: "5",
  netIncome: "5000",
};
const LATEST: Values = {
  fiscalYearEnd: "2025-12-31",
  price: "121",
  shares: "900",
  eps: "7.2",
  netIncome: "6480",
};

const near = (value: string | null) => Number(value);

describe("divergence views", () => {
  it("computes the three views and the share-count bias exactly", () => {
    const views = computeDivergenceViews(pair(EARLIER, LATEST));

    expect(views.version).toBe(DIVERGENCE_VIEWS_VERSION);
    expect(near(views.years)).toBeCloseTo(731 / 365.2425, 12);
    // 731 days is a hair over two years, so 21 % over two years is ~10 %.
    expect(near(views.growth.price.value)).toBeCloseTo(9.993, 2);
    expect(views.fundamental.category).toBe("comparable");
    expect(views.aggregate.category).toBe("comparable");
    expect(views.perShare.category).toBe("comparable");

    const mc = near(views.growth.marketCap.value);
    const eps = near(views.growth.dilutedEps.value);
    const price = near(views.growth.price.value);
    expect(near(views.fundamental.gapPp)).toBeCloseTo(eps - mc, 10);
    // Buybacks: price grew faster than market cap.
    expect(near(views.fundamental.shareCountBiasPp)).toBeGreaterThan(0);
    expect(near(views.fundamental.shareCountBiasPp)).toBeCloseTo(
      price - mc,
      10,
    );
    expect(views.fundamental.perShareGapPp).toBe(views.perShare.gapPp);
    expect(views.marketCapBasis).toBe("shares_outstanding_at_close");
    // ~5.4 % fewer shares a year is above the 2 pp tolerance.
    expect(views.fundamental.biasMarked).toBe(true);
  });

  it("leaves a small bias unmarked", () => {
    const views = computeDivergenceViews(
      pair(EARLIER, { ...LATEST, shares: "980" }),
    );

    expect(near(views.fundamental.shareCountBiasPp)).toBeLessThan(2);
    expect(views.fundamental.biasMarked).toBe(false);
  });

  it("falls back to average diluted shares at both ends, and names it", () => {
    const views = computeDivergenceViews(
      pair(
        { ...EARLIER, shares: null, dilutedShares: "1000" },
        { ...LATEST, shares: null, dilutedShares: "900" },
      ),
    );

    expect(views.marketCapBasis).toBe("weighted_diluted_shares");
    expect(views.fundamental.category).toBe("comparable");
    expect(near(views.fundamental.shareCountBiasPp)).toBeCloseTo(
      near(views.growth.price.value) - near(views.growth.marketCap.value),
      10,
    );
  });

  it("never mixes a close count with an average", () => {
    const views = computeDivergenceViews(
      pair(EARLIER, { ...LATEST, shares: null, dilutedShares: null }),
    );

    expect(views.marketCapBasis).toBeNull();
    expect(views.growth.marketCap.reason).toBe("missing_input");
  });

  it("does not fall back over unreconciled share classes", () => {
    const multiple = ["multiple_share_classes_unreconciled"];
    const views = computeDivergenceViews(
      pair(
        { ...EARLIER, shares: null, dilutedShares: "1000", missing: multiple },
        { ...LATEST, shares: null, dilutedShares: "900", missing: multiple },
      ),
    );

    expect(views.marketCapBasis).toBeNull();
    expect(views.fundamental.category).toBe("unavailable");
    expect(views.perShare.category).toBe("comparable");
  });

  it("names a dilution as a negative bias", () => {
    const views = computeDivergenceViews(
      pair(EARLIER, { ...LATEST, shares: "1200" }),
    );

    expect(near(views.fundamental.shareCountBiasPp)).toBeLessThan(0);
    expect(near(views.growth.dilutedShares.value)).toBeGreaterThan(0);
  });

  it("gives non-positive earnings a category, never a growth rate", () => {
    const turnedPositive = computeDivergenceViews(
      pair({ ...EARLIER, eps: "-1", netIncome: "-1000" }, LATEST),
    );
    expect(turnedPositive.fundamental.category).toBe(
      "earnings_turned_positive",
    );
    expect(turnedPositive.aggregate.category).toBe("earnings_turned_positive");
    expect(turnedPositive.growth.dilutedEps).toEqual({
      value: null,
      reason: "non_positive_endpoint",
    });
    expect(turnedPositive.fundamental.gapPp).toBeNull();
    expect(turnedPositive.fundamental.perShareGapPp).toBeNull();

    const turnedNegative = computeDivergenceViews(
      pair(EARLIER, { ...LATEST, eps: "0", netIncome: "0" }),
    );
    expect(turnedNegative.perShare.category).toBe(
      "earnings_turned_non_positive",
    );

    const stayed = computeDivergenceViews(
      pair(
        { ...EARLIER, eps: "-2", netIncome: "-2" },
        { ...LATEST, eps: "-1", netIncome: "-1" },
      ),
    );
    expect(stayed.aggregate.category).toBe("earnings_non_positive");
    // The value side still has its own growth.
    expect(stayed.growth.marketCap.value).not.toBeNull();
  });

  it("keeps a view valid when another is not", () => {
    const views = computeDivergenceViews(
      pair(EARLIER, {
        ...LATEST,
        splitReason: "split_evidence_missing_or_ambiguous",
      }),
    );

    expect(views.growth.price.reason).toBe("split_basis_unreconciled");
    expect(views.growth.dilutedEps.reason).toBe("split_basis_unreconciled");
    expect(views.growth.marketCap.reason).toBe("split_basis_unreconciled");
    expect(views.growth.netIncome.value).not.toBeNull();
    expect(views.fundamental.category).toBe("unavailable");
    expect(views.perShare.category).toBe("unavailable");
    expect(views.fundamental.shareCountBiasPp).toBeNull();
  });

  it("names a missing input instead of reading it as zero", () => {
    const views = computeDivergenceViews(
      pair(EARLIER, { ...LATEST, netIncome: null, shares: null }),
    );

    expect(views.growth.netIncome).toEqual({
      value: null,
      reason: "missing_input",
    });
    expect(views.growth.marketCap.reason).toBe("missing_input");
    expect(views.aggregate.category).toBe("unavailable");
    expect(views.perShare.category).toBe("comparable");
  });

  it("returns every view unavailable without a comparable year", () => {
    const views = computeDivergenceViews({
      version: FISCAL_ENDPOINTS_VERSION,
      horizonYears: 5,
      actualYears: null,
      latest: point(LATEST),
      earlier: null,
      reason: "no_comparable_year",
    });

    expect(views.years).toBeNull();
    expect(views.growth.marketCap.reason).toBe("no_comparable_year");
    expect(views.fundamental.category).toBe("unavailable");
  });

  it("returns finite canonical strings", () => {
    const views = computeDivergenceViews(pair(EARLIER, LATEST));

    for (const growth of Object.values(views.growth)) {
      expect(growth.value).toMatch(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u);
    }
  });
});
