import { describe, expect, it } from "vitest";

import { DECIMAL_POLICY as SHARED_POLICY } from "@/modules/numeric/domain/decimal-policy";

import {
  DECIMAL_POLICY,
  divide,
  formatDecimal,
  ONE,
  parseDecimal,
  toFixedScale,
  ZERO,
} from "./decimal-policy";
import { isValuationPolicyError } from "./valuation-error";

/**
 * La aritmética se prueba en `src/modules/numeric/`. Acá sólo importa lo que el
 * motor agrega: que cada falla sea un `ValuationPolicyError` con su código, porque
 * eso es lo que la corrida persiste como rechazo.
 */
describe("valuation decimal policy binding", () => {
  it("carries the shared policy into engine_version unchanged", () => {
    expect(DECIMAL_POLICY).toBe(SHARED_POLICY);
  });

  it.each([
    ["division_by_zero", () => divide(ONE, ZERO, "dilutedShares")],
    ["non_finite_value", () => formatDecimal(ONE.div(0), "enterpriseValue")],
    ["invalid_decimal", () => parseDecimal("1e5", "baseRevenue.value")],
    ["invalid_decimal", () => toFixedScale(ONE, 99, "display")],
  ] as const)("fails with a ValuationPolicyError %s", (code, action) => {
    expect(action).toThrowError();

    try {
      action();
    } catch (error) {
      expect(isValuationPolicyError(error, code)).toBe(true);
    }
  });
});
