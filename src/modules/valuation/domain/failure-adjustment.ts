import { z } from "zod";
import { engineDecimalSchema } from "./decimal-policy";
import { formatDecimal, ONE, parseDecimal, ZERO } from "./decimal-policy";
import { ValuationPolicyError } from "./valuation-error";

/**
 * Probabilidad de fracaso (`F4-05`, ADR 0040, `failure-adjustment-1.0.0`).
 *
 * ```text
 * valor_operativo = DCF × (1 − p) + recupero × p
 * recupero        = fracción × capital invertido en libros
 * ```
 *
 * El DCF supone una empresa en marcha; Damodaran separa la posibilidad de que
 * no lo sea en vez de esconderla en la tasa. `p` es la probabilidad de default
 * acumulada del rating sintético de la corrida y la fracción es la de su
 * planilla Ginzu: la mitad del capital en libros, que es el capital invertido
 * que deriva la normalización.
 *
 * Un capital en libros no positivo —una empresa con más caja que deuda y
 * patrimonio— no se recupera en negativo: la responsabilidad es limitada. El
 * recupero es cero y la base lo dice (`non_positive_book_capital`), nunca un
 * recorte silencioso.
 */
export const FAILURE_ADJUSTMENT_VERSION = "failure-adjustment-1.0.0";

/** Fracción del capital en libros que se recupera si la empresa fracasa. */
export const DISTRESS_PROCEEDS_FRACTION = "0.5";

export const failureAdjustmentSchema = z.object({
  version: z.literal(FAILURE_ADJUSTMENT_VERSION),
  probability: engineDecimalSchema,
  proceedsFraction: engineDecimalSchema,
  proceedsBasis: z.enum(["book_capital", "non_positive_book_capital"]),
  proceeds: engineDecimalSchema,
  goingConcernValue: engineDecimalSchema,
  adjustedOperatingValue: engineDecimalSchema,
});
export type FailureAdjustment = z.infer<typeof failureAdjustmentSchema>;

export function adjustForFailure(input: {
  goingConcernValue: string;
  probability: string;
  bookCapital: string;
}): FailureAdjustment {
  const path = "failure";
  const goingConcern = parseDecimal(input.goingConcernValue, "enterpriseValue");
  const probability = parseDecimal(input.probability, `${path}.probability`);
  const bookCapital = parseDecimal(input.bookCapital, `${path}.bookCapital`);
  const fraction = parseDecimal(
    DISTRESS_PROCEEDS_FRACTION,
    `${path}.proceedsFraction`,
  );

  if (probability.isNeg() || probability.gt(ONE)) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "A probability of failure lies between zero and one.",
      [`${path}.probability`],
    );
  }

  const positiveBook = bookCapital.gt(ZERO);
  const proceeds = positiveBook ? bookCapital.times(fraction) : ZERO;
  const adjusted = goingConcern
    .times(ONE.minus(probability))
    .plus(proceeds.times(probability));

  return {
    version: FAILURE_ADJUSTMENT_VERSION,
    probability: formatDecimal(probability, `${path}.probability`),
    proceedsFraction: formatDecimal(fraction, `${path}.proceedsFraction`),
    proceedsBasis: positiveBook ? "book_capital" : "non_positive_book_capital",
    proceeds: formatDecimal(proceeds, `${path}.proceeds`),
    goingConcernValue: formatDecimal(goingConcern, "enterpriseValue"),
    adjustedOperatingValue: formatDecimal(
      adjusted,
      `${path}.adjustedOperatingValue`,
    ),
  };
}
