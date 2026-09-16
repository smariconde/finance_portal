import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Política numérica compartida del proyecto, fijada por
 * [ADR 0003](../../../../docs/architecture/adr/0003-decimal-arithmetic-valuation-engine.md)
 * y su enmienda de `F2-04`.
 *
 * Este módulo es el **único** que importa `decimal.js`, y ESLint lo hace cumplir.
 * Nació dentro de la valuación; se mudó acá cuando ajustar una serie por un split
 * exigió la misma aritmética fuera del motor. Mudarlo, y no copiarlo, es la
 * decisión: dos constructores configurados por separado pueden divergir en
 * silencio, y un ajuste por split que redondea distinto que el motor produciría
 * dos valores para el mismo hecho.
 *
 * Lo que queda de cada consumidor es **su error**. La valuación falla con
 * `ValuationPolicyError` y un ajuste por split con el error de su contrato; los
 * códigos son los mismos, así que `createDecimalOperations` recibe la fábrica y
 * devuelve las operaciones ligadas a ella.
 *
 * El resto del dominio recibe y devuelve strings decimales canónicos, de modo que
 * ninguna instancia pueda entrar en un hash, en un DTO ni en la persistencia.
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
 * la configuración global y cambie los resultados. `toExpNeg` y `toExpPos` no son
 * cosméticos: un valor que a veces se imprime `1e+21` y a veces
 * `1000000000000000000000` produciría dos hashes para el mismo número.
 */
const Engine = Decimal.clone({
  precision: DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** Instancia interna. Nunca cruza una frontera ni se serializa. */
export type Dec = Decimal;

/**
 * Decimal canónico de cálculo. Admite más dígitos que el de una observación
 * porque una división a 34 cifras significativas es un resultado legítimo, no un
 * valor reportado por una fuente.
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

export const DECIMAL_ERROR_CODES = [
  /** El string recibido no es un decimal canónico. */
  "invalid_decimal",
  /** NaN, Infinity o una operación sin resultado representable. */
  "non_finite_value",
  /** Divisor cero: nunca se devuelve Infinity en su lugar. */
  "division_by_zero",
] as const;

export type DecimalErrorCode = (typeof DECIMAL_ERROR_CODES)[number];

/**
 * Cómo falla cada consumidor. `subjects` son rutas de campo, nunca valores
 * recibidos (`TM-02`).
 */
export type DecimalErrorFactory = (
  code: DecimalErrorCode,
  message: string,
  subjects: readonly string[],
) => Error;

/**
 * Serialización de **presentación**: escala fija bajo la misma política de
 * redondeo. No reemplaza a `formatDecimal`, que es la única forma en que un valor
 * entra en un hash o en la persistencia: acá el valor ya se redondeó para leerse,
 * así que nunca vuelve al cálculo.
 */
export const MAX_DISPLAY_SCALE = 12;

export type DecimalOperations = {
  readonly parseDecimal: (value: string, path: string) => Dec;
  readonly assertFinite: (value: Dec, path: string) => Dec;
  readonly divide: (numerator: Dec, denominator: Dec, path: string) => Dec;
  readonly formatDecimal: (value: Dec, path: string) => string;
  readonly toFixedScale: (value: Dec, scale: number, path: string) => string;
};

export function createDecimalOperations(
  toError: DecimalErrorFactory,
): DecimalOperations {
  /**
   * Guarda de finitud. `decimal.js` propaga `Infinity` y `NaN` en vez de fallar,
   * así que se interceptan antes de que un no finito llegue a un hash o a una
   * superficie.
   */
  const assertFinite = (value: Dec, path: string): Dec => {
    if (!value.isFinite()) {
      throw toError(
        "non_finite_value",
        "Operation produced a value without a finite decimal representation.",
        [path],
      );
    }

    return value;
  };

  const parseDecimal = (value: string, path: string): Dec => {
    const parsed = engineDecimalSchema.safeParse(value);

    if (!parsed.success) {
      throw toError(
        "invalid_decimal",
        "Value is not a canonical decimal string.",
        [path],
      );
    }

    return assertFinite(new Engine(parsed.data), path);
  };

  /**
   * División explícita. Una división inválida es un error de policy, no un
   * resultado.
   */
  const divide = (numerator: Dec, denominator: Dec, path: string): Dec => {
    if (denominator.isZero()) {
      throw toError(
        "division_by_zero",
        "Division by zero is a policy failure, not a result.",
        [path],
      );
    }

    return assertFinite(numerator.div(denominator), path);
  };

  /**
   * Serialización canónica: notación fija, sin exponente y sin cero con signo.
   * Es la única forma en que un valor calculado sale de un cálculo.
   */
  const formatDecimal = (value: Dec, path: string): string => {
    const finite = assertFinite(value, path);

    return finite.isZero() ? "0" : finite.toFixed();
  };

  /**
   * El cero con signo se normaliza porque `-0,00` sugiere una magnitud negativa
   * que la escala mostrada no puede sostener.
   */
  const toFixedScale = (value: Dec, scale: number, path: string): string => {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DISPLAY_SCALE) {
      throw toError(
        "invalid_decimal",
        `A display scale must be an integer between 0 and ${MAX_DISPLAY_SCALE}.`,
        [path],
      );
    }

    const fixed = assertFinite(value, path).toFixed(scale);

    return /^-0(?:\.0+)?$/u.test(fixed) ? fixed.slice(1) : fixed;
  };

  return Object.freeze({
    parseDecimal,
    assertFinite,
    divide,
    formatDecimal,
    toFixedScale,
  });
}

export const ZERO: Dec = new Engine(0);
export const ONE: Dec = new Engine(1);
export const HUNDRED: Dec = new Engine(100);

export function sum(values: readonly Dec[]): Dec {
  return values.reduce<Dec>((total, value) => total.plus(value), ZERO);
}
