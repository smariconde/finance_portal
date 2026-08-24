import Decimal from "decimal.js";
import { z } from "zod";

import { ValuationPolicyError } from "./valuation-error";

/**
 * Política numérica del motor, fijada por
 * [ADR 0003](../../../../docs/architecture/adr/0003-decimal-arithmetic-valuation-engine.md)
 * y `docs/valuation/methodology.md`.
 *
 * Este módulo es el **único** que importa `decimal.js`. El resto del dominio
 * recibe y devuelve strings decimales canónicos, de modo que ninguna instancia
 * pueda entrar en un hash, en un DTO ni en la persistencia. La precisión y el
 * modo de redondeo forman parte de `engine_version`: cambiarlos es un cambio
 * material que no reescribe corridas históricas.
 */
export const DECIMAL_PRECISION = 34;
export const DECIMAL_ROUNDING = "ROUND_HALF_EVEN" as const;

export const decimalPolicySchema = z.object({
  precision: z.literal(DECIMAL_PRECISION),
  rounding: z.literal(DECIMAL_ROUNDING),
});

export type DecimalPolicy = z.infer<typeof decimalPolicySchema>;

export const DECIMAL_POLICY: DecimalPolicy = Object.freeze({
  precision: DECIMAL_PRECISION,
  rounding: DECIMAL_ROUNDING,
});

/**
 * Constructor aislado: `clone` impide que otro consumidor de la librería mueva
 * la configuración global y cambie los resultados del motor. `toExpNeg` y
 * `toExpPos` no son cosméticos: un valor que a veces se imprime `1e+21` y a
 * veces `1000000000000000000000` produciría dos hashes para el mismo número.
 */
const Engine = Decimal.clone({
  precision: DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** Instancia interna del motor. Nunca cruza una frontera ni se serializa. */
export type Dec = Decimal;

/**
 * Decimal canónico de motor. Admite más dígitos que el de una observación
 * porque una división a 34 cifras significativas es un resultado legítimo del
 * cálculo, no un valor reportado por una fuente.
 */
export const engineDecimalSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u,
    "value must be a canonical decimal string.",
  );

/** Tasa expresada como fracción: `0.08` es 8%. */
export const rateSchema = engineDecimalSchema;

export function parseDecimal(value: string, path: string): Dec {
  const parsed = engineDecimalSchema.safeParse(value);

  if (!parsed.success) {
    throw new ValuationPolicyError(
      "invalid_decimal",
      "Value is not a canonical decimal string.",
      [path],
    );
  }

  return assertFinite(new Engine(parsed.data), path);
}

/**
 * Guarda de finitud. `decimal.js` propaga `Infinity` y `NaN` en vez de fallar,
 * así que el motor los intercepta antes de que un no finito llegue a un hash o
 * a una superficie.
 */
export function assertFinite(value: Dec, path: string): Dec {
  if (!value.isFinite()) {
    throw new ValuationPolicyError(
      "non_finite_value",
      "Operation produced a value without a finite decimal representation.",
      [path],
    );
  }

  return value;
}

/**
 * División explícita. El motor nunca devuelve `Infinity` ante un divisor cero:
 * una división inválida es un error de policy, no un resultado.
 */
export function divide(numerator: Dec, denominator: Dec, path: string): Dec {
  if (denominator.isZero()) {
    throw new ValuationPolicyError(
      "division_by_zero",
      "Division by zero is a policy failure, not a result.",
      [path],
    );
  }

  return assertFinite(numerator.div(denominator), path);
}

/**
 * Serialización canónica de un decimal: notación fija, sin exponente y sin cero
 * con signo. Es la única forma en que un valor calculado sale del motor.
 */
export function formatDecimal(value: Dec, path: string): string {
  const finite = assertFinite(value, path);

  return finite.isZero() ? "0" : finite.toFixed();
}

export const ZERO: Dec = new Engine(0);
export const ONE: Dec = new Engine(1);

export function sum(values: readonly Dec[]): Dec {
  return values.reduce<Dec>((total, value) => total.plus(value), ZERO);
}
