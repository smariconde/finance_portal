import {
  providerCostToNanoUsd,
  type AiAttemptOutcome,
  type AiSpendPurpose,
  type AiSpendStatus,
} from "@/modules/ai/domain/ai-spend";
import type { AiTask, AiTaskJudgement } from "@/modules/ai/domain/ai-task";
import {
  AI_MODEL_LADDER,
  AI_MODEL_LADDER_VERSION,
  worstCaseNanoUsd,
  type ModelRung,
} from "@/modules/ai/domain/model-ladder";
import type { ProviderBreaker } from "@/modules/ai/domain/provider-breaker";
import {
  RequestBudgetExhaustedError,
  type EgressFetch,
} from "@/modules/ingestion/application/egress-fetch";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import type { AiSpendStore } from "./ai-spend-store";
import {
  callOpenRouterChat,
  encodeOpenRouterBody,
  OPENROUTER_SOURCE_ID,
  type OpenRouterChatResult,
} from "./openrouter-chat";

/**
 * Corre una tarea por la escalera de modelos (ADR 0033, decisiones 4 y 5).
 *
 * Por escalón, en este orden y sin atajos:
 *
 * 1. si el breaker está abierto, frena;
 * 2. reserva el peor caso; si no entra, la llamada no sale y la tarea se
 *    abstiene con `ai_budget_exhausted`;
 * 3. llama, y liquida la reserva con lo que pasó —el costo informado, cero si
 *    no salió o el proveedor no cobra, el peor caso si se cortó a mitad—;
 * 4. valida la salida contra el schema y la juzga con la policy de la tarea.
 *
 * Sube de escalón si la respuesta no llega, no valida, la policy la rechaza o
 * el modelo se abstiene. La primera aceptada termina. Cada intento queda en el
 * libro con el modelo pedido, el que respondió, tokens, costo, latencia y el
 * motivo, que es la métrica de la capa.
 */
export const MODEL_LADDER_RUNNER_VERSION = "model-ladder-runner-1.0.0";

export type LadderAttempt = {
  readonly rung: number;
  readonly requestedModel: string;
  readonly respondedModel: string | null;
  readonly outcome: AiAttemptOutcome;
  /** Código de la policy, motivo de la abstención o código del egress. */
  readonly detail: string | null;
  readonly status: AiSpendStatus;
  readonly reservedNanoUsd: number;
  readonly chargedNanoUsd: number | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly latencyMs: number | null;
};

export type LadderStopCode =
  | "breaker_open"
  | "provider_unauthorized"
  | "source_disabled"
  | "spend_undeclared"
  | "request_budget_exhausted"
  | "egress_refused";

export type LadderResult<Output> = {
  /** Agrupa los intentos en el libro de gasto: es el `task_run_id` de sus filas. */
  readonly taskRunId: string;
} & (
  | {
      readonly outcome: "accepted";
      readonly rung: number;
      readonly model: string;
      readonly output: Output;
      readonly attempts: readonly LadderAttempt[];
    }
  | {
      readonly outcome: "abstained";
      /**
       * `ai_budget_exhausted` si un tope en dólares no dejó salir la llamada,
       * `ladder_exhausted` si ningún escalón dio una respuesta aceptable, o el
       * motivo con que se abstuvo el último escalón.
       */
      readonly reason: string;
      readonly detail: string | null;
      readonly attempts: readonly LadderAttempt[];
    }
  | {
      /** Algo ajeno a la tarea frenó la corrida: no sigue con otra tarea. */
      readonly outcome: "stopped";
      readonly code: LadderStopCode;
      readonly detail: string | null;
      readonly attempts: readonly LadderAttempt[];
    }
);

/**
 * Lo que vio un intento que obtuvo respuesta: la salida validada —también la
 * que la policy rechazó— y el veredicto. Sólo lo leen los evals de `F5-07`
 * (ADR 0035): el libro nunca guarda el texto del modelo.
 */
export type LadderObservation = {
  readonly rung: number;
  readonly finishReason: string | null;
  /** `null` si no validó contra el schema. */
  readonly output: unknown;
  readonly judgement: AiTaskJudgement | null;
};

export type RunModelLadderDependencies = {
  readonly fetch: EgressFetch;
  readonly spend: AiSpendStore;
  readonly breaker: ProviderBreaker;
  readonly ladder?: readonly ModelRung[];
  readonly ladderVersion?: string;
  /** `task` salvo en un eval; los dos gastan contra los mismos topes. */
  readonly purpose?: AiSpendPurpose;
  readonly observe?: (observation: LadderObservation) => void;
  readonly now: () => string;
  /** Reloj monótono: mide la latencia. */
  readonly elapsedMs: () => number;
  readonly newId: () => string;
};

const TRANSPORT_EGRESS_CODES: ReadonlySet<string> = new Set([
  "address_unresolvable",
  "deadline_exceeded",
  "transport_error",
  "response_too_large",
]);

/**
 * Qué falló en una salida que no validó: el campo y el código del primer
 * problema, o `not_json`. Nunca el contenido: el texto del modelo no se guarda
 * en el libro (`TM-16` sin `TM-02`). Si el modelo cortó por largo, se dice.
 */
function describeSchemaFailure(
  issues:
    | readonly {
        readonly path: readonly PropertyKey[];
        readonly code: string;
      }[]
    | null,
  finishReason: string | null,
): string {
  const first = issues?.[0];
  const what =
    first === undefined
      ? "not_json"
      : `${first.path.map(String).join(".") || "root"}:${first.code}`;

  return (
    finishReason !== null && finishReason !== "stop"
      ? `${what}|${finishReason}`
      : what
  ).slice(0, 96);
}

function egressCode(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null)?.code;

  return typeof code === "string" ? code : null;
}

type CallOutcome =
  | { readonly kind: "response"; readonly result: OpenRouterChatResult }
  | {
      readonly kind: "refused";
      readonly code: LadderStopCode;
      readonly detail: string;
    }
  | { readonly kind: "transport"; readonly detail: string };

async function callOnce(
  fetch: EgressFetch,
  body: Uint8Array,
): Promise<CallOutcome> {
  try {
    return { kind: "response", result: await callOpenRouterChat(fetch, body) };
  } catch (cause) {
    // Nuestras negativas —kill switch, cuota del día, techo del proceso— no
    // abrieron un socket: no son una falla del proveedor.
    if (cause instanceof SourceRequestRefusedError) {
      return {
        kind: "refused",
        code:
          cause.code === "source_disabled"
            ? "source_disabled"
            : "request_budget_exhausted",
        detail: cause.code,
      };
    }

    if (cause instanceof RequestBudgetExhaustedError) {
      return {
        kind: "refused",
        code: "request_budget_exhausted",
        detail: "run_request_budget",
      };
    }

    const code = egressCode(cause);

    if (code !== null && TRANSPORT_EGRESS_CODES.has(code)) {
      return { kind: "transport", detail: code };
    }

    // Allowlist, credencial ausente, método: configuración, no el proveedor.
    return {
      kind: "refused",
      code: "egress_refused",
      detail: code ?? "egress_failed",
    };
  }
}

export async function runModelLadder<Input, Output>(
  task: AiTask<Input, Output>,
  input: Input,
  dependencies: RunModelLadderDependencies,
): Promise<LadderResult<Output>> {
  const {
    fetch,
    spend,
    breaker,
    ladder = AI_MODEL_LADDER,
    ladderVersion = AI_MODEL_LADDER_VERSION,
    purpose = "task",
    observe,
    now,
    elapsedMs,
    newId,
  } = dependencies;
  const taskRunId = newId();
  const messages = task.buildMessages(input);
  const attempts: LadderAttempt[] = [];
  let lastAbstention: string | null = null;

  for (const rung of ladder) {
    if (breaker.isOpen()) {
      return {
        taskRunId,
        outcome: "stopped",
        code: "breaker_open",
        detail: `${breaker.consecutiveFailures()} consecutive transport failures`,
        attempts,
      };
    }

    const body = encodeOpenRouterBody({
      rung,
      messages,
      maxOutputTokens: task.maxOutputTokens,
      output: task.output,
    });
    const reservedNanoUsd = worstCaseNanoUsd(
      rung,
      body.byteLength,
      task.maxOutputTokens,
    );
    const reservationId = newId();
    const verdict = await spend.reserve({
      reservationId,
      purpose,
      sourceId: OPENROUTER_SOURCE_ID,
      taskRunId,
      taskVersion: task.taskVersion,
      ladderVersion,
      rung: rung.rung,
      requestedModel: rung.model,
      worstCaseNanoUsd: reservedNanoUsd,
      now: now(),
    });

    if (verdict.status === "source_disabled") {
      return {
        taskRunId,
        outcome: "stopped",
        code: "source_disabled",
        detail: verdict.reason,
        attempts,
      };
    }

    if (verdict.status === "spend_undeclared") {
      return {
        taskRunId,
        outcome: "stopped",
        code: "spend_undeclared",
        detail: null,
        attempts,
      };
    }

    if (verdict.status !== "reserved") {
      return {
        taskRunId,
        outcome: "abstained",
        reason: "ai_budget_exhausted",
        detail: verdict.status,
        attempts,
      };
    }

    const startedAt = elapsedMs();
    const call = await callOnce(fetch, body);
    const latencyMs = Math.max(0, Math.round(elapsedMs() - startedAt));

    const settle = async (attempt: {
      outcome: AiAttemptOutcome;
      detail: string | null;
      status: Exclude<AiSpendStatus, "reserved">;
      chargedNanoUsd: number | null;
      respondedModel: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
      latencyMs: number | null;
    }) => {
      await spend.settle({
        reservationId,
        status: attempt.status,
        chargedNanoUsd: attempt.chargedNanoUsd,
        respondedModel: attempt.respondedModel,
        promptTokens: attempt.promptTokens,
        completionTokens: attempt.completionTokens,
        latencyMs: attempt.latencyMs,
        outcome: attempt.outcome,
        now: now(),
      });
      attempts.push({
        rung: rung.rung,
        requestedModel: rung.model,
        reservedNanoUsd,
        ...attempt,
      });
    };

    if (call.kind === "refused") {
      // No salió nada: la reserva se libera entera.
      await settle({
        outcome: "egress_refused",
        detail: call.detail,
        status: "uncharged",
        chargedNanoUsd: null,
        respondedModel: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs: null,
      });

      return {
        taskRunId,
        outcome: "stopped",
        code: call.code,
        detail: call.detail,
        attempts,
      };
    }

    if (call.kind === "transport") {
      // Se cortó con la llamada en curso: pudo haberse cobrado, así que la
      // reserva queda por su peor caso.
      breaker.recordTransportFailure();
      await settle({
        outcome: "transport_error",
        detail: call.detail,
        status: "unsettled",
        chargedNanoUsd: null,
        respondedModel: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs,
      });
      continue;
    }

    const result = call.result;

    if (result.kind !== "completed") {
      // Un error del proveedor no cobra. Un `429` o un `5xx` acercan el
      // breaker; un `4xx` es este pedido, no el proveedor.
      const outcome: AiAttemptOutcome =
        result.kind === "unauthorized"
          ? "provider_unauthorized"
          : result.kind === "throttled"
            ? "provider_throttled"
            : result.kind === "unavailable"
              ? "provider_unavailable"
              : result.kind === "rejected"
                ? "provider_rejected"
                : "response_unreadable";

      if (result.kind === "throttled" || result.kind === "unavailable") {
        breaker.recordTransportFailure();
      }

      // Un `2xx` ilegible pudo haberse cobrado: queda por su peor caso.
      await settle({
        outcome,
        detail: `status ${result.status}`,
        status: result.kind === "unreadable" ? "unsettled" : "uncharged",
        chargedNanoUsd: null,
        respondedModel: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs,
      });

      if (result.kind === "unauthorized") {
        return {
          taskRunId,
          outcome: "stopped",
          code: "provider_unauthorized",
          detail: `status ${result.status}`,
          attempts,
        };
      }

      continue;
    }

    breaker.recordSuccess();

    const charged =
      result.costUsd === null ? null : providerCostToNanoUsd(result.costUsd);
    const billing = {
      // Sin costo informado no se sabe cuánto se cobró: cuenta el peor caso.
      status: (charged === null ? "unsettled" : "charged") as
        "charged" | "unsettled",
      chargedNanoUsd: charged,
      respondedModel: result.respondedModel,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs,
    };

    let json: unknown;

    try {
      json = JSON.parse(result.content ?? "");
    } catch {
      observe?.({
        rung: rung.rung,
        finishReason: result.finishReason,
        output: null,
        judgement: null,
      });
      await settle({
        ...billing,
        outcome: "schema_invalid",
        detail: describeSchemaFailure(null, result.finishReason),
      });
      continue;
    }

    const parsed = task.output.schema.safeParse(json);

    if (!parsed.success) {
      observe?.({
        rung: rung.rung,
        finishReason: result.finishReason,
        output: null,
        judgement: null,
      });
      await settle({
        ...billing,
        outcome: "schema_invalid",
        detail: describeSchemaFailure(parsed.error.issues, result.finishReason),
      });
      continue;
    }

    const output: Output = parsed.data;

    const judgement = task.judge(output, input);

    observe?.({
      rung: rung.rung,
      finishReason: result.finishReason,
      output,
      judgement,
    });

    if (judgement.verdict === "accept") {
      await settle({ ...billing, outcome: "accepted", detail: null });

      return {
        taskRunId,
        outcome: "accepted",
        rung: rung.rung,
        model: result.respondedModel,
        output,
        attempts,
      };
    }

    if (judgement.verdict === "abstain") {
      lastAbstention = judgement.reason;
      await settle({
        ...billing,
        outcome: "abstained",
        detail: judgement.reason,
      });
      continue;
    }

    lastAbstention = null;
    await settle({
      ...billing,
      outcome: "policy_rejected",
      detail: judgement.code,
    });
  }

  const last = attempts.at(-1);

  return last?.outcome === "abstained" && lastAbstention !== null
    ? {
        taskRunId,
        outcome: "abstained",
        reason: lastAbstention,
        detail: null,
        attempts,
      }
    : {
        taskRunId,
        outcome: "abstained",
        reason: "ladder_exhausted",
        detail: last?.outcome ?? null,
        attempts,
      };
}
