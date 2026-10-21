import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { parseDecimal } from "./decimal-policy";
import {
  deriveAssumptions,
  DERIVED_ASSUMPTIONS_VERSION,
  type DerivedAssumptions,
} from "./derived-assumptions";
import { computeFcff } from "./fcff";
import {
  compareWithMarketPrice,
  marketImpliedContext,
  marketImpliedExpectations,
  shareBasisDate,
  type MarketClose,
  type MarketImpliedReading,
} from "./market-implied";
import type { ValuationInput } from "./valuation-input";

const base = DEMO_VALUATION_INPUT;
const baseYear = base.baseRevenue.asOf;

/** Cuatro ejercicios que crecen 10 % por año hasta el revenue de la corrida. */
const HISTORY: DerivedAssumptions = {
  version: DERIVED_ASSUMPTIONS_VERSION,
  revenueHistory: [
    { fiscalYearEnd: baseYear, value: base.baseRevenue.value },
    {
      fiscalYearEnd: "2023-12-31",
      value: "87272727.27272727272727272727272727",
    },
    {
      fiscalYearEnd: "2022-12-31",
      value: "79338842.97520661157024793388429752",
    },
    {
      fiscalYearEnd: "2021-12-31",
      value: "72126220.88655146506386175807663411",
    },
  ],
};

function derivedInput(): ValuationInput {
  const result = deriveAssumptions({
    derivation: HISTORY,
    baseFiscalYearEnd: baseYear,
    normalization: base.normalization,
    costOfCapital: base.costOfCapital,
  });

  if (result.status !== "derived") {
    throw new Error(result.reason);
  }

  return {
    ...base,
    periods: [...result.periods],
    terminal: result.terminal,
    sensitivity: result.sensitivity,
    scenarios: null,
    derivedAssumptions: HISTORY,
  };
}

const input = derivedInput();
const computed = computeFcff(input);
const run = {
  asOf: input.asOf,
  currency: input.currency,
  input,
  // Sólo el valor por acción importa a la comparación.
  result: { valuePerShare: computed.valuePerShare } as never,
};

function closeAt(close: string, overrides: Partial<MarketClose> = {}) {
  return {
    marketDate: input.asOf,
    close,
    currency: input.currency,
    ...overrides,
  };
}

function compare(close: string, overrides: Partial<MarketClose> = {}) {
  return compareWithMarketPrice({
    run,
    closes: [closeAt(close, overrides)],
    events: [],
  });
}

function reading(
  readings: readonly MarketImpliedReading[],
  driver: MarketImpliedReading["driver"],
) {
  const found = readings.find((entry) => entry.driver === driver);

  if (found === undefined) throw new Error(driver);

  return found;
}

function readingsAt(close: string, runInput: ValuationInput = input) {
  const implied = marketImpliedExpectations({
    run: { input: runInput },
    comparison: compareWithMarketPrice({
      run: { ...run, input: runInput },
      closes: [closeAt(close)],
      events: [],
    }),
  });

  if (implied.status !== "computed") throw new Error(implied.reason);

  return implied.readings;
}

describe("market-price-comparison-1.0.0", () => {
  it("compares the close at the run's as_of with the value per share", () => {
    const value = parseDecimal(computed.valuePerShare, "value");
    const price = value.times(2).toFixed(2);
    const comparison = compare(price);

    expect(comparison.status).toBe("compared");
    if (comparison.status !== "compared") return;

    expect(comparison.price.close).toBe(price);
    expect(
      parseDecimal(comparison.priceToValue, "p/v")
        .toDecimalPlaces(2)
        .toNumber(),
    ).toBe(2);
    expect(
      parseDecimal(comparison.valueToPrice, "v/p")
        .toDecimalPlaces(2)
        .toNumber(),
    ).toBe(-0.5);
  });

  it("never reads a close from another day", () => {
    const comparison = compareWithMarketPrice({
      run,
      closes: [closeAt("10", { marketDate: "2024-12-30" })],
      events: [],
    });

    expect(comparison).toMatchObject({
      status: "unavailable",
      reason: "no_close_at_as_of",
      price: null,
    });
  });

  it("names a rejected run, another currency and a non-positive close", () => {
    expect(
      compareWithMarketPrice({
        run: { ...run, result: null },
        closes: [closeAt("10")],
        events: [],
      }),
    ).toMatchObject({ status: "unavailable", reason: "no_value_per_share" });
    expect(compare("10", { currency: "ARS" })).toMatchObject({
      reason: "currency_mismatch",
    });
    expect(compare("0")).toMatchObject({ reason: "non_positive_close" });
  });

  it("names a non-positive value per share instead of a ratio", () => {
    expect(
      compareWithMarketPrice({
        run: { ...run, result: { valuePerShare: "-1.5" } as never },
        closes: [closeAt("10")],
        events: [],
      }),
    ).toMatchObject({ reason: "non_positive_value" });
  });

  it("refuses a split between the share basis and the close", () => {
    const basis = shareBasisDate(input);
    const after = compareWithMarketPrice({
      run,
      closes: [closeAt("10")],
      events: [{ eventType: "split", effectiveOn: input.asOf }],
    });
    const before = compareWithMarketPrice({
      run,
      closes: [closeAt("10")],
      events: [
        { eventType: "split", effectiveOn: basis },
        { eventType: "dividend", effectiveOn: input.asOf },
      ],
    });

    expect(basis <= input.asOf).toBe(true);
    expect(after).toMatchObject({ reason: "split_after_share_basis" });
    expect(before.status).toBe("compared");
  });
});

describe("market-implied-1.0.0", () => {
  it("returns the run's own drivers when the price is the value", () => {
    const readings = readingsAt(computed.valuePerShare);

    for (const entry of readings) {
      expect(entry.status, entry.driver).toBe("solved");
      if (entry.status !== "solved") continue;

      expect(
        parseDecimal(entry.implied, "implied")
          .minus(parseDecimal(entry.runValue, "run"))
          .abs()
          .lessThan("0.000002"),
        entry.driver,
      ).toBe(true);
    }
  });

  it("asks more of every driver when the price is above the value", () => {
    const price = parseDecimal(computed.valuePerShare, "value")
      .times("1.3")
      .toFixed(4);
    const readings = readingsAt(price);
    const implied = (driver: MarketImpliedReading["driver"]) => {
      const entry = reading(readings, driver);

      if (entry.status !== "solved") throw new Error(entry.status);

      return parseDecimal(entry.implied, driver);
    };

    expect(
      implied("revenue_growth").greaterThan(input.periods[0]!.revenueGrowth),
    ).toBe(true);
    expect(implied("ebit_margin").greaterThan(input.terminal.ebitMargin)).toBe(
      true,
    );
    expect(implied("discount_rate").lessThan(input.periods[0]!.wacc)).toBe(
      true,
    );
  });

  it("puts the engine back on the price at the implied driver", () => {
    const price = parseDecimal(computed.valuePerShare, "value").times("1.3");
    const readings = readingsAt(price.toFixed(4));
    const margin = reading(readings, "ebit_margin");

    if (margin.status !== "solved") throw new Error(margin.status);

    const value = parseDecimal(
      computeFcff(input, { ebitMargin: margin.implied }).valuePerShare,
      "value",
    );

    // Seis decimales en el margen mueven el valor menos de un 0,01 %.
    expect(value.dividedBy(price).minus(1).abs().lessThan("0.0001")).toBe(true);
  });

  it("says which side the price falls on when a driver cannot reach it", () => {
    const readings = readingsAt("1000000000");

    for (const entry of readings) {
      expect(entry.status, entry.driver).toBe("price_above_range");
      if (entry.status !== "price_above_range") continue;

      expect(
        parseDecimal(entry.closestValuePerShare, "closest").lessThan(
          "1000000000",
        ),
      ).toBe(true);
    }
  });

  it("does not move growth on a snapshot that is not shaped by the rule", () => {
    const handWritten = { ...input, derivedAssumptions: undefined };
    const readings = readingsAt(computed.valuePerShare, handWritten);

    expect(reading(readings, "revenue_growth")).toMatchObject({
      status: "unavailable",
      reason: "growth_shape_unsupported",
    });
    expect(reading(readings, "ebit_margin").status).toBe("solved");
  });

  it("does not solve without a compared price", () => {
    expect(
      marketImpliedExpectations({
        run: { input },
        comparison: compare("0"),
      }),
    ).toMatchObject({ status: "unavailable", reason: "price_not_compared" });
  });

  it("is deterministic", () => {
    const price = parseDecimal(computed.valuePerShare, "value")
      .times("0.8")
      .toFixed(4);

    expect(readingsAt(price)).toEqual(readingsAt(price));
  });
});

describe("market-implied context", () => {
  it("measures growth over the full frozen history and the last three years", () => {
    const context = marketImpliedContext(input);

    expect(
      context.historicalGrowth.map((entry) => ({
        years: entry.years,
        from: entry.fromFiscalYearEnd,
        cagr: parseDecimal(entry.cagr, "cagr").toDecimalPlaces(10).toString(),
      })),
    ).toEqual([{ years: 3, from: "2021-12-31", cagr: "0.1" }]);
    expect(context.baseEbitMargin).toBe(
      input.normalization.base.ebitMarginAdjusted,
    );
    expect(context.wacc).toBe(input.costOfCapital.derived.wacc);
  });

  it("has no historical growth on a hand-written snapshot", () => {
    expect(
      marketImpliedContext({ ...input, derivedAssumptions: undefined })
        .historicalGrowth,
    ).toEqual([]);
  });
});
