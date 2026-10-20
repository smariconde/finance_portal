import { describe, expect, it } from "vitest";

import { parseDecimal, type Dec } from "./decimal-policy";
import {
  blackScholesCall,
  OPTION_VALUE_VERSION,
  standardNormalCdf,
  valueEmployeeOptions,
} from "./option-value";
import { isValuationPolicyError } from "./valuation-error";

const dec = (value: string): Dec => parseDecimal(value, "test");

/** Los oráculos de doble precisión vienen de `math.erf`/`math.erfc` de Python. */
describe("standardNormalCdf", () => {
  it("is exactly one half at zero", () => {
    expect(standardNormalCdf(dec("0")).toString()).toBe("0.5");
  });

  it("matches the published value of N(1) to thirty digits", () => {
    expect(standardNormalCdf(dec("1")).toFixed(30)).toBe(
      "0.841344746068542948585232545632",
    );
  });

  it("matches an independent double-precision oracle", () => {
    const cases: [string, number][] = [
      ["1.96", 0.9750021048517796],
      ["6", 0.9999999990134123],
      ["-3.5", 0.00023262907903552504],
      ["-8.25", 7.919726314642473e-17],
    ];

    for (const [x, expected] of cases) {
      const value = standardNormalCdf(dec(x)).toNumber();

      expect(Math.abs(value - expected) / expected).toBeLessThan(1e-13);
    }
  });

  it("is symmetric: N(x) + N(−x) = 1", () => {
    for (const x of ["0.3", "2.7", "11"]) {
      expect(
        standardNormalCdf(dec(x))
          .plus(standardNormalCdf(dec(x).negated()))
          .toString(),
      ).toBe("1");
    }
  });

  it("saturates far in the tails instead of iterating forever", () => {
    expect(standardNormalCdf(dec("40")).toString()).toBe("1");
    expect(standardNormalCdf(dec("-40")).toString()).toBe("0");
  });
});

describe("blackScholesCall", () => {
  const base = {
    price: dec("100"),
    strike: dec("95"),
    maturity: dec("3"),
    volatility: dec("0.3"),
    riskFree: dec("0.04"),
    dividendYield: dec("0.01"),
  };

  it("matches an independent double-precision oracle", () => {
    expect(blackScholesCall(base).toNumber()).toBeCloseTo(
      25.64208514282027,
      11,
    );
  });

  it("falls to the discounted intrinsic value without volatility or time", () => {
    // 100·e^(−0.03) − 95·e^(−0.12)
    expect(
      blackScholesCall({ ...base, volatility: dec("0") }).toNumber(),
    ).toBeCloseTo(100 * Math.exp(-0.03) - 95 * Math.exp(-0.12), 12);
    expect(blackScholesCall({ ...base, maturity: dec("0") }).toString()).toBe(
      "5",
    );
    expect(
      blackScholesCall({
        ...base,
        strike: dec("120"),
        maturity: dec("0"),
      }).toString(),
    ).toBe("0");
  });

  it("is the discounted price for a zero strike", () => {
    expect(
      blackScholesCall({ ...base, strike: dec("0") }).toNumber(),
    ).toBeCloseTo(100 * Math.exp(-0.03), 12);
  });

  it("is worth more with more volatility and a lower strike", () => {
    const value = blackScholesCall(base);

    expect(
      blackScholesCall({ ...base, volatility: dec("0.4") }).gt(value),
    ).toBe(true);
    expect(blackScholesCall({ ...base, strike: dec("80") }).gt(value)).toBe(
      true,
    );
  });
});

describe("valueEmployeeOptions", () => {
  const input = {
    price: "100",
    strike: "95",
    maturityYears: "3",
    volatility: "0.3",
    riskFree: "0.04",
    dividendYield: "0.01",
    optionsOutstanding: "50",
    sharesOutstanding: "1000",
  };

  it("iterates the dilution-adjusted price to a fixed point", () => {
    const result = valueEmployeeOptions(input);

    expect(result.version).toBe(OPTION_VALUE_VERSION);
    expect(Number(result.adjustedPrice)).toBeCloseTo(96.3425158459242, 10);
    expect(Number(result.valuePerOption)).toBeCloseTo(23.192832764408145, 10);
    expect(Number(result.totalValue)).toBeCloseTo(1159.6416382204072, 8);
    expect(result.iterations).toBeGreaterThan(1);
  });

  it("is worth less than the undiluted Black-Scholes value", () => {
    const result = valueEmployeeOptions(input);

    expect(Number(result.valuePerOption)).toBeLessThan(25.64208514282027);
  });

  it("is deterministic", () => {
    expect(valueEmployeeOptions(input)).toStrictEqual(
      valueEmployeeOptions(input),
    );
  });

  it("rejects invalid inputs by path, never clamping them to zero", () => {
    try {
      valueEmployeeOptions({
        ...input,
        price: "0",
        strike: "-1",
        volatility: "-0.1",
        optionsOutstanding: "0",
      });
    } catch (error) {
      expect(isValuationPolicyError(error)).toBe(true);
      expect(isValuationPolicyError(error) && error.subjects).toStrictEqual([
        "employeeEquity.options.price",
        "employeeEquity.options.strike",
        "employeeEquity.options.volatility",
        "employeeEquity.options.count",
      ]);
      return;
    }

    throw new Error("expected a rejection");
  });
});
