/**
 * Escalera declarada de modelos baratos
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 5).
 *
 * Una tarea empieza en el escalón 1 y sube cuando la respuesta no llega, no
 * valida, la policy la rechaza o se abstiene; la primera aceptada termina. Tres
 * familias distintas a propósito: una falla propia de una familia sube a otra.
 *
 * Cambiar un modelo o un precio es un diff revisable que sube la versión. Nada
 * de esto se lee del entorno: ni el modelo, ni el precio máximo, ni los
 * requisitos de privacidad del pedido.
 */
export const AI_MODEL_LADDER_VERSION = "ai-model-ladder-1.0.0";

export type ModelRung = {
  readonly rung: number;
  /** ID de OpenRouter. */
  readonly model: string;
  /**
   * Precio máximo aceptado, en nanodólares por token: USD por millón × 1.000.
   * Es a la vez el `max_price` que se le pide al enrutador y el precio con que
   * se calcula el peor caso de la reserva.
   */
  readonly maxPromptNanoUsdPerToken: number;
  readonly maxCompletionNanoUsdPerToken: number;
  /**
   * Esfuerzo de razonamiento pedido, para modelos que razonan antes de
   * contestar. OpenRouter lo normaliza por proveedor y `require_parameters`
   * excluye a los endpoints que no lo respetan. Sin él, decide el modelo.
   */
  readonly reasoning?: { readonly effort: ReasoningEffort };
};

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export const AI_MODEL_LADDER: readonly ModelRung[] = Object.freeze([
  Object.freeze({
    rung: 1,
    model: "deepseek/deepseek-v4.1-flash",
    maxPromptNanoUsdPerToken: 600,
    maxCompletionNanoUsdPerToken: 2_400,
  }),
  Object.freeze({
    rung: 2,
    model: "openai/gpt-5.6-luna",
    maxPromptNanoUsdPerToken: 250,
    maxCompletionNanoUsdPerToken: 1_500,
  }),
  Object.freeze({
    rung: 3,
    model: "google/gemini-3.8-flash",
    maxPromptNanoUsdPerToken: 1_350,
    maxCompletionNanoUsdPerToken: 6_750,
  }),
]);

/**
 * Peor caso de una llamada, en nanodólares.
 *
 * No hay tokenizador en el proyecto, y no hace falta: en los tokenizadores BPE
 * cada token cubre al menos un byte, así que los bytes UTF-8 del cuerpo del
 * pedido son una cota superior de los tokens de entrada. Es conservadora —el
 * JSON del pedido cuenta también— y es exactamente lo que se quiere de una
 * reserva. La salida se acota con `max_tokens`.
 */
export function worstCaseNanoUsd(
  rung: ModelRung,
  requestBytes: number,
  maxOutputTokens: number,
): number {
  if (
    !Number.isInteger(requestBytes) ||
    requestBytes < 0 ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  ) {
    throw new RangeError("A worst case needs whole, non-negative sizes.");
  }

  return (
    requestBytes * rung.maxPromptNanoUsdPerToken +
    maxOutputTokens * rung.maxCompletionNanoUsdPerToken
  );
}

/**
 * `max_price` de OpenRouter, en USD por millón de tokens. Se deriva del precio
 * entero del escalón y no se declara por separado: dos números para el mismo
 * techo terminarían divergiendo.
 */
export function openRouterMaxPrice(rung: ModelRung): {
  readonly prompt: number;
  readonly completion: number;
} {
  return {
    prompt: rung.maxPromptNanoUsdPerToken / 1000,
    completion: rung.maxCompletionNanoUsdPerToken / 1000,
  };
}
