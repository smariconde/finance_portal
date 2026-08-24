/**
 * Errores obligatorios del motor de valuación
 * (`docs/valuation/methodology.md`). Son códigos estables y auditables: la
 * superficie que los reciba decide cómo mostrarlos, pero ninguno puede
 * convertirse en un valor por defecto silencioso ni en un cero.
 */
export const VALUATION_ERROR_CODES = [
  /** El string recibido no es un decimal canónico. */
  "invalid_decimal",
  /** NaN, Infinity o una operación sin resultado representable. */
  "non_finite_value",
  /** Divisor cero: el motor nunca devuelve Infinity en su lugar. */
  "division_by_zero",
  /** Uno o más policy checks en modo `reject` fallaron. */
  "policy_check_failed",
  /** El método pedido no está implementado; nunca cae a FCFF en silencio. */
  "unsupported_method",
] as const;

export type ValuationErrorCode = (typeof VALUATION_ERROR_CODES)[number];

export class ValuationPolicyError extends Error {
  readonly code: ValuationErrorCode;
  /** Sólo rutas de campo e IDs de check: nunca valores recibidos (`TM-02`). */
  readonly subjects: readonly string[];

  constructor(
    code: ValuationErrorCode,
    message: string,
    subjects: readonly string[] = [],
  ) {
    super(message);
    this.name = "ValuationPolicyError";
    this.code = code;
    this.subjects = [...subjects];
  }
}

export function isValuationPolicyError(
  error: unknown,
  code?: ValuationErrorCode,
): error is ValuationPolicyError {
  return (
    error instanceof ValuationPolicyError &&
    (code === undefined || error.code === code)
  );
}
