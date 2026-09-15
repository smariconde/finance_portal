import { describe, expect, it } from "vitest";

import {
  DECIMAL_POLICY,
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import { isValuationPolicyError } from "./valuation-error";

const path = "test";

function value(input: string) {
  return parseDecimal(input, path);
}

describe("decimal policy", () => {
  it("declares the policy that engine_version carries", () => {
    expect(DECIMAL_POLICY).toStrictEqual({
      precision: 34,
      rounding: "ROUND_HALF_EVEN",
    });
  });

  it("adds the amounts IEEE-754 cannot", () => {
    // `0.1 + 0.2 === 0.30000000000000004` en binario. Un hash sobre ese
    // resultado no sería reproducible.
    expect(formatDecimal(value("0.1").plus(value("0.2")), path)).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("keeps exact cents across a long sum", () => {
    const cents = Array.from({ length: 10 }, () => value("0.1"));

    expect(formatDecimal(sum(cents), path)).toBe("1");
  });

  it("breaks ties to the even digit instead of always upward", () => {
    // 35 dígitos significativos: el 35º es un 5 exacto, así que el redondeo a
    // 34 es un empate y ROUND_HALF_EVEN decide por el dígito conservado.
    const towardsEven = value("1.0000000000000000000000000000000005").times(
      ONE,
    );
    const awayFromEven = value("1.0000000000000000000000000000000015").times(
      ONE,
    );

    expect(formatDecimal(towardsEven, path)).toBe("1");
    expect(formatDecimal(awayFromEven, path)).toBe(
      "1.000000000000000000000000000000002",
    );
  });

  it("never emits exponential notation", () => {
    const large = value("10000000000000000000000000").times(value("1000"));
    const small = divide(ONE, value("100000000000000000000"), path);

    expect(formatDecimal(large, path)).toBe("10000000000000000000000000000");
    expect(formatDecimal(small, path)).toBe("0.00000000000000000001");
  });

  it("serializes zero without a sign", () => {
    expect(formatDecimal(value("-0"), path)).toBe("0");
    expect(formatDecimal(value("5").times(ZERO).negated(), path)).toBe("0");
  });

  it("preserves a negative amount instead of folding it", () => {
    expect(formatDecimal(value("-4200000"), path)).toBe("-4200000");
  });

  it("rejects a divisor of zero instead of returning Infinity", () => {
    expect(() => divide(ONE, ZERO, "dilutedShares")).toThrowError(
      /Division by zero/u,
    );

    try {
      divide(ONE, ZERO, "dilutedShares");
    } catch (error) {
      expect(isValuationPolicyError(error, "division_by_zero")).toBe(true);
      expect((error as { subjects: string[] }).subjects).toStrictEqual([
        "dilutedShares",
      ]);
    }
  });

  it("refuses to serialize a non finite value", () => {
    // `decimal.js` propaga Infinity; la guarda existe para que ninguno llegue a
    // un hash o a una superficie.
    const infinite = ONE.div(0);

    expect(() => formatDecimal(infinite, "enterpriseValue")).toThrowError();
    try {
      formatDecimal(infinite, "enterpriseValue");
    } catch (error) {
      expect(isValuationPolicyError(error, "non_finite_value")).toBe(true);
    }
  });

  it.each([
    ["100,000,000", "separadores de miles"],
    ["1e5", "notación exponencial"],
    ["", "cadena vacía"],
    ["  ", "sólo espacios"],
    ["01", "cero a la izquierda"],
    ["1.", "punto colgante"],
    ["NaN", "no numérico"],
    ["Infinity", "no finito escrito"],
  ])("rejects %s as a canonical decimal (%s)", (input) => {
    expect(() => parseDecimal(input, "baseRevenue.value")).toThrowError();

    try {
      parseDecimal(input, "baseRevenue.value");
    } catch (error) {
      expect(isValuationPolicyError(error, "invalid_decimal")).toBe(true);
      expect((error as { subjects: string[] }).subjects).toStrictEqual([
        "baseRevenue.value",
      ]);
    }
  });

  it("divides at the declared precision", () => {
    expect(formatDecimal(divide(ONE, value("3"), path), path)).toBe(
      "0.3333333333333333333333333333333333",
    );
  });
});
