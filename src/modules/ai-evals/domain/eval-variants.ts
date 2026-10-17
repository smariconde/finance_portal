import {
  AI_MODEL_LADDER,
  AI_MODEL_LADDER_VERSION,
  type ModelRung,
} from "@/modules/ai/domain/model-ladder";

/**
 * Las escaleras que los evals comparan (`F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisión 7). La vigente se mide tal cual; una candidata es un diff revisable
 * con versión propia, y el ID es lo que el libro de gasto registra como
 * versión de la escalera de cada intento de eval.
 *
 * Una candidata reemplaza a la vigente sólo si, sobre el mismo corpus, los dos
 * gates duros siguen en cero, la corrección de los casos base no baja y mejora
 * schema, aceptación o costo por caso aceptado sin empeorar lo demás.
 */
export type EvalVariant = {
  readonly variantId: string;
  readonly description: string;
  readonly ladder: readonly ModelRung[];
};

export const EVAL_VARIANTS: readonly EvalVariant[] = Object.freeze([
  {
    variantId: AI_MODEL_LADDER_VERSION,
    description: "La escalera vigente, sin esfuerzo de razonamiento pedido.",
    ladder: AI_MODEL_LADDER,
  },
  {
    variantId: "ai-eval-low-effort-1.0.0",
    description:
      "Los mismos tres modelos con esfuerzo de razonamiento bajo: el libro mostró que los escalones 1 y 3 agotan la salida razonando.",
    ladder: AI_MODEL_LADDER.map((rung) => ({
      ...rung,
      reasoning: { effort: "low" as const },
    })),
  },
]);

export function findEvalVariant(variantId: string): EvalVariant | null {
  return (
    EVAL_VARIANTS.find((variant) => variant.variantId === variantId) ?? null
  );
}
