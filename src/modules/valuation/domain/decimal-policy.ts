import {
  createDecimalOperations,
  engineDecimalSchema,
} from "@/modules/numeric/domain/decimal-policy";

import { ValuationPolicyError } from "./valuation-error";

/**
 * Política numérica del motor: la compartida del proyecto
 * (`src/modules/numeric/domain/decimal-policy.ts`) ligada al error de la
 * valuación. La precisión y el modo de redondeo forman parte de
 * `engine_version`: cambiarlos es un cambio material que no reescribe corridas
 * históricas.
 *
 * Nada de la aritmética vive acá. Este archivo sólo decide cómo falla el motor,
 * para que un `division_by_zero` siga siendo un `ValuationPolicyError` que la
 * corrida persiste como rechazo.
 */
export {
  DECIMAL_POLICY,
  DECIMAL_PRECISION,
  DECIMAL_ROUNDING,
  decimalPolicySchema,
  engineDecimalSchema,
  HUNDRED,
  MAX_DISPLAY_SCALE,
  ONE,
  sum,
  ZERO,
  type Dec,
  type DecimalPolicy,
} from "@/modules/numeric/domain/decimal-policy";

/** Tasa expresada como fracción: `0.08` es 8%. */
export const rateSchema = engineDecimalSchema;

export const {
  parseDecimal,
  assertFinite,
  divide,
  formatDecimal,
  toFixedScale,
} = createDecimalOperations(
  (code, message, subjects) =>
    new ValuationPolicyError(code, message, subjects),
);
