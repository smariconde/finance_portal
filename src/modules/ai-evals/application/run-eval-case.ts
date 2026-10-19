import {
  runModelLadder,
  type LadderObservation,
  type LadderStopCode,
  type RunModelLadderDependencies,
} from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { INDUSTRY_RESOLUTION_TASK } from "@/modules/valuation/domain/industry-resolution-task";
import { OPERATIONS_MIX_TASK } from "@/modules/valuation/domain/operations-mix-task";

import type { EvalCase } from "../domain/eval-cases";
import type { EvalAttempt } from "../domain/eval-scoring";
import type { EvalVariant } from "../domain/eval-variants";

/**
 * Manda un caso a **un** escalón de una variante y devuelve la medición
 * (`F5-07`, [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisiones 1 y 6).
 *
 * Usa la misma escalera, el mismo libro y los mismos topes que una tarea, con
 * `purpose: "eval"`; la versión de la escalera que queda en el libro es el ID
 * de la variante. La salida del modelo se ve por el observador y no se guarda
 * en ningún lado de la base.
 */
export type EvalCaseResult =
  | { readonly status: "measured"; readonly attempt: EvalAttempt }
  /** Nada salió: un tope, el kill switch o el breaker. La corrida para. */
  | {
      readonly status: "stopped";
      readonly code: LadderStopCode | "ai_budget_exhausted";
      readonly detail: string | null;
    };

export async function runEvalCase(
  evalCase: EvalCase,
  variant: EvalVariant,
  rung: number,
  dependencies: Omit<
    RunModelLadderDependencies,
    "ladder" | "ladderVersion" | "purpose" | "observe"
  >,
): Promise<EvalCaseResult> {
  const step = variant.ladder.find((candidate) => candidate.rung === rung);

  if (step === undefined) {
    throw new Error(`${variant.variantId} has no rung ${rung}.`);
  }

  let observation: LadderObservation | null = null;
  const run = {
    ...dependencies,
    ladder: [step],
    ladderVersion: variant.variantId,
    purpose: "eval" as const,
    observe: (seen: LadderObservation) => {
      observation = seen;
    },
  };
  const result =
    evalCase.task === "industry"
      ? await runModelLadder(
          INDUSTRY_RESOLUTION_TASK as AiTask<typeof evalCase.input, unknown>,
          evalCase.input,
          run,
        )
      : await runModelLadder(
          OPERATIONS_MIX_TASK as AiTask<typeof evalCase.input, unknown>,
          evalCase.input,
          run,
        );
  const [attempt] = result.attempts;

  if (attempt === undefined || attempt.outcome === "egress_refused") {
    return result.outcome === "stopped"
      ? { status: "stopped", code: result.code, detail: result.detail }
      : {
          status: "stopped",
          code: "ai_budget_exhausted",
          detail: result.outcome === "abstained" ? result.detail : null,
        };
  }

  const seen = observation as LadderObservation | null;

  return {
    status: "measured",
    attempt: {
      variantId: variant.variantId,
      caseId: evalCase.caseId,
      rung,
      requestedModel: attempt.requestedModel,
      respondedModel: attempt.respondedModel,
      outcome: attempt.outcome,
      detail: attempt.detail,
      finishReason: seen?.finishReason ?? null,
      output: seen?.output ?? null,
      countedNanoUsd:
        attempt.status === "charged"
          ? attempt.chargedNanoUsd!
          : attempt.status === "uncharged"
            ? 0
            : attempt.reservedNanoUsd,
      promptTokens: attempt.promptTokens,
      completionTokens: attempt.completionTokens,
      latencyMs: attempt.latencyMs,
    },
  };
}
