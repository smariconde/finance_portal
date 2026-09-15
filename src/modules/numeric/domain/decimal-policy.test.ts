import { describe, expect, it } from "vitest";

import {
  createDecimalOperations,
  DECIMAL_POLICY,
  ONE,
  sum,
  ZERO,
  type DecimalErrorCode,
} from "./decimal-policy";

/** Error propio del test: la política no conoce a sus consumidores. */
class TestDecimalError extends Error {
  readonly code: DecimalErrorCode;
  readonly subjects: readonly string[];

  constructor(
    code: DecimalErrorCode,
    message: string,
    subjects: readonly string[],
  ) {
    super(message);
    this.code = code;
    this.subjects = subjects;
  }
}

const { parseDecimal, divide, formatDecimal, toFixedScale } =
  createDecimalOperations(
    (code, message, subjects) => new TestDecimalError(code, message, subjects),
  );

const path = "test";

function value(input: string) {
  return parseDecimal(input, path);
}

function captured(action: () => unknown): TestDecimalError {
  try {
    action();
  } catch (error) {
    if (error instanceof TestDecimalError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the operation to fail");
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
    const error = captured(() => divide(ONE, ZERO, "dilutedShares"));

    expect(error.message).toMatch(/Division by zero/u);
    expect(error.code).toBe("division_by_zero");
    expect(error.subjects).toStrictEqual(["dilutedShares"]);
  });

  it("refuses to serialize a non finite value", () => {
    // `decimal.js` propaga Infinity; la guarda existe para que ninguno llegue a
    // un hash o a una superficie.
    const infinite = ONE.div(0);

    expect(
      captured(() => formatDecimal(infinite, "enterpriseValue")).code,
    ).toBe("non_finite_value");
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
    const error = captured(() => parseDecimal(input, "baseRevenue.value"));

    expect(error.code).toBe("invalid_decimal");
    expect(error.subjects).toStrictEqual(["baseRevenue.value"]);
  });

  it("divides at the declared precision", () => {
    expect(formatDecimal(divide(ONE, value("3"), path), path)).toBe(
      "0.3333333333333333333333333333333333",
    );
  });

  it("rejects a display scale outside the declared range", () => {
    expect(captured(() => toFixedScale(ONE, 13, "display")).code).toBe(
      "invalid_decimal",
    );
    expect(toFixedScale(value("-0.001"), 2, "display")).toBe("0.00");
  });

  it("binds every consumer to the same arithmetic and its own error", () => {
    // Dos consumidores con errores distintos calculan exactamente lo mismo: la
    // configuración vive en un solo constructor, no en cada fábrica.
    class OtherError extends Error {}
    const other = createDecimalOperations(
      (_code, message) => new OtherError(message),
    );

    expect(other.formatDecimal(other.divide(ONE, value("7"), path), path)).toBe(
      formatDecimal(divide(ONE, value("7"), path), path),
    );
    expect(() => other.divide(ONE, ZERO, path)).toThrowError(OtherError);
  });
});
