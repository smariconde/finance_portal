import { describe, expect, it } from "vitest";

import type { FundamentalRow } from "@/modules/valuation/domain/annual-fundamentals";

import {
  computeDilutionBridge,
  DILUTION_BRIDGE_VERSION,
  halfPrintedUnit,
} from "./dilution-bridge";
import { computeDivergenceViews } from "./divergence-views";
import {
  FISCAL_ENDPOINTS_VERSION,
  type FiscalEndpoint,
  type FiscalEndpointPair,
} from "./fiscal-endpoints";
import { FISCAL_SPLIT_BASIS_VERSION } from "./fiscal-split-basis";

type Values = {
  readonly fiscalYearEnd: string;
  readonly price: string;
  readonly eps: string | null;
  readonly netIncome: string | null;
  readonly numerator?: string | null;
  readonly diluted: string | null;
  readonly basic: string | null;
  readonly splitReason?: FiscalEndpoint["splitBasis"]["reason"];
};

function point(values: Values): FiscalEndpoint {
  const numerator = values.numerator ?? null;
  return {
    fiscalYearEnd: values.fiscalYearEnd,
    price: { currency: "USD" } as FiscalEndpoint["price"],
    priceLagDays: 0,
    netIncome:
      values.netIncome === null
        ? null
        : ({ value: values.netIncome } as FiscalEndpoint["netIncome"]),
    dilutedEps: null,
    dilutedShares:
      values.diluted === null
        ? null
        : ({
            unit: "shares",
            currency: null,
          } as FiscalEndpoint["dilutedShares"]),
    sharesOutstanding: null,
    basicShares: null,
    dilutedNumerator:
      numerator === null ? null : ({ value: numerator } as FundamentalRow),
    splitBasis: {
      version: FISCAL_SPLIT_BASIS_VERSION,
      priceFactor: "1",
      actionIds: [],
      adjustedPrice: values.price,
      adjustedEps: values.eps,
      adjustedDilutedShares: values.diluted,
      adjustedSharesOutstanding: null,
      adjustedBasicShares: values.basic,
      reason: values.splitReason ?? null,
    },
    marketCap: null,
    missing: [],
  };
}

function bridge(earlier: Values, latest: Values) {
  const pair: FiscalEndpointPair = {
    version: FISCAL_ENDPOINTS_VERSION,
    horizonYears: 2,
    actualYears: null,
    latest: point(latest),
    earlier: point(earlier),
    reason: null,
  };
  return computeDilutionBridge(pair, computeDivergenceViews(pair));
}

const EARLIER: Values = {
  fiscalYearEnd: "2023-12-31",
  price: "100",
  eps: "5.00",
  netIncome: "5000000010",
  diluted: "1000000002",
  basic: "980000001",
};
const LATEST: Values = {
  fiscalYearEnd: "2025-12-31",
  price: "121",
  eps: "7.25",
  netIncome: "6525000029",
  diluted: "900000004",
  basic: "880000003",
};

describe("halfPrintedUnit", () => {
  it("reads the printed unit from trailing zeros or decimals", () => {
    expect(halfPrintedUnit("132170000000")).toBe("5000000");
    expect(halfPrintedUnit("3333290000")).toBe("5000");
    expect(halfPrintedUnit("341971")).toBe("0.5");
    expect(halfPrintedUnit("-900.25")).toBe("0.005");
  });
});

describe("dilution bridge", () => {
  it("reconciles EPS with its numerator and the diluted count", () => {
    const result = bridge(EARLIER, LATEST);

    expect(result.version).toBe(DILUTION_BRIDGE_VERSION);
    expect(result.latest).toMatchObject({
      numeratorBasis: "net_income",
      impliedDilutedShares: "900000004",
      residualPct: "0",
      reconciled: true,
      reason: null,
    });
    expect(Number(result.latest?.dilutivePct)).toBeCloseTo(
      (900000004 / 880000003 - 1) * 100,
      10,
    );
    // Half a cent over EPS plus half a share and half a dollar of rounding.
    expect(Number(result.latest?.roundingBoundPct)).toBeCloseTo(
      (0.005 / 7.25 + 0.5 / 6525000029 + 0.5 / 900000004) * 100,
      10,
    );
  });

  it("names a residual larger than EPS rounding", () => {
    const result = bridge(EARLIER, { ...LATEST, netIncome: "6600000029" });

    expect(Number(result.latest?.residualPct)).toBeCloseTo(
      (6600000029 / 7.25 / 900000004 - 1) * 100,
      10,
    );
    expect(result.latest?.reconciled).toBe(false);
  });

  it("prefers EPS's own numerator when tagged", () => {
    const result = bridge(EARLIER, {
      ...LATEST,
      netIncome: "6600000029",
      numerator: "6525000029",
    });

    expect(result.latest).toMatchObject({
      numeratorBasis: "net_income_available_to_common_diluted",
      reconciled: true,
    });
  });

  it("keeps the view identity exact", () => {
    const result = bridge(EARLIER, LATEST);
    const earnings = Number(result.earningsShareEffectPp);
    const value = Number(result.valueShareEffectPp);

    expect(Number(result.viewGapDifferencePp)).toBeCloseTo(
      earnings - value,
      12,
    );
  });

  it("compares a loss with its loss per share, never a sign mismatch", () => {
    const loss = bridge(EARLIER, {
      ...LATEST,
      eps: "-1.00",
      netIncome: "-900000004",
    });
    expect(loss.latest?.reconciled).toBe(true);

    const mismatch = bridge(EARLIER, { ...LATEST, eps: "-1.00" });
    expect(mismatch.latest).toMatchObject({
      reason: "non_positive_input",
      residualPct: null,
    });
  });

  it("names a missing input or an unreconciled split basis", () => {
    expect(bridge(EARLIER, { ...LATEST, eps: null }).latest?.reason).toBe(
      "missing_input",
    );
    expect(
      bridge(EARLIER, { ...LATEST, basic: null }).latest?.dilutivePct,
    ).toBeNull();
    expect(
      bridge(EARLIER, {
        ...LATEST,
        splitReason: "split_evidence_missing_or_ambiguous",
      }).latest,
    ).toMatchObject({ reason: "split_basis_unreconciled", dilutivePct: null });
  });
});
