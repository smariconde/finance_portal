import type { LadderResult } from "@/modules/ai/application/run-model-ladder";

import {
  QUALITATIVE_TASK_ORDER,
  valuationQualitativeStepSchema,
  VALUATION_QUALITATIVE_RULE_VERSION,
  type QualitativeTask,
  type QualitativeTaskStep,
  type ValuationQualitativeStep,
} from "../domain/valuation-qualitative-step";

import type { ProposeEmployeeEquityResult } from "./propose-employee-equity";
import type { ProposeOperationsMixResult } from "./propose-operations-mix";
import type { ResolveCompanyIndustryResult } from "./resolve-company-industry";

/**
 * El paso cualitativo de la corrida (`F6-13`,
 * [ADR 0052](../../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)).
 *
 * Pregunta a la IA lo que la evaluación dijo que falta: la industria de un SIC
 * ambiguo, la transcripción de opciones de empleados y el mix de operaciones.
 * Cada tarea es la misma que corre su comando, con su policy, su evidencia y su
 * tope en dólares; este paso sólo decide cuáles correr, en qué orden, y qué
 * registra el job. Una tarea que lanza no tira el job: queda `failed` con su
 * código y las otras siguen.
 */
export type QualitativeNeeds = Readonly<Record<QualitativeTask, boolean>>;

export type QualitativeDecisionDependencies = {
  readonly resolveIndustry: () => Promise<ResolveCompanyIndustryResult>;
  readonly proposeEmployeeEquity: () => Promise<ProposeEmployeeEquityResult>;
  readonly proposeOperationsMix: () => Promise<ProposeOperationsMixResult>;
};

type TaskReading = {
  readonly step: QualitativeTaskStep;
  readonly chargedNanoUsd: number;
  /** La escalera frenó por algo ajeno a la tarea: no se sigue con otra. */
  readonly stopped: boolean;
};

export async function ensureQualitativeDecisions(
  needs: QualitativeNeeds,
  dependencies: QualitativeDecisionDependencies,
): Promise<ValuationQualitativeStep> {
  const run: Record<QualitativeTask, () => Promise<TaskReading>> = {
    industry: async () => readIndustry(await dependencies.resolveIndustry()),
    employeeEquity: async () =>
      readProposal(await dependencies.proposeEmployeeEquity()),
    operationsMix: async () =>
      readProposal(await dependencies.proposeOperationsMix()),
  };
  const steps = {} as Record<QualitativeTask, QualitativeTaskStep>;
  let chargedNanoUsd = 0;
  let stopped = false;

  for (const task of QUALITATIVE_TASK_ORDER) {
    if (!needs[task]) {
      steps[task] = { status: "present" };
      continue;
    }

    if (stopped) {
      steps[task] = { status: "not_run" };
      continue;
    }

    try {
      const reading = await run[task]();

      steps[task] = reading.step;
      chargedNanoUsd += reading.chargedNanoUsd;
      stopped = reading.stopped;
    } catch (error) {
      steps[task] = { status: "failed", code: failureCode(error) };
    }
  }

  return valuationQualitativeStepSchema.parse({
    ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
    ...steps,
    chargedNanoUsd,
  });
}

function charged(ladder: LadderResult<unknown>): number {
  return ladder.attempts.reduce(
    (total, attempt) => total + (attempt.chargedNanoUsd ?? 0),
    0,
  );
}

function fromLadder(
  ladder: LadderResult<unknown>,
  accepted: boolean,
): TaskReading {
  const chargedNanoUsd = charged(ladder);

  switch (ladder.outcome) {
    case "accepted":
      return {
        // Una respuesta aceptada que no se guardó no es una decisión: el job
        // siguiente no la vería.
        step: accepted
          ? { status: "accepted", rung: ladder.rung }
          : { status: "skipped", reason: "not_written" },
        chargedNanoUsd,
        stopped: false,
      };
    case "abstained":
      return {
        step: { status: "abstained", reason: ladder.reason },
        chargedNanoUsd,
        stopped: false,
      };
    case "stopped":
      return {
        step: { status: "stopped", code: ladder.code },
        chargedNanoUsd,
        stopped: true,
      };
  }
}

function readIndustry(result: ResolveCompanyIndustryResult): TaskReading {
  if (result.status === "skipped") {
    return {
      step: { status: "skipped", reason: result.reason },
      chargedNanoUsd: 0,
      stopped: false,
    };
  }

  return fromLadder(
    result.ladder,
    result.written && result.record.outcome === "resolved",
  );
}

function readProposal(
  result: ProposeEmployeeEquityResult | ProposeOperationsMixResult,
): TaskReading {
  if (result.status === "skipped") {
    return {
      step: { status: "skipped", reason: result.reason },
      chargedNanoUsd: 0,
      stopped: false,
    };
  }

  return fromLadder(
    result.ladder,
    result.written && result.stored.proposal.outcome === "accepted",
  );
}

const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

/**
 * El nombre del error como código: `AiTransferRefusedError` es
 * `ai_transfer_refused`. Nunca el mensaje, que puede traer una URL o un cuerpo.
 */
export function failureCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const code = name
    .replace(/Error$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .slice(0, 64);

  return CODE.test(code) ? code : "task_error";
}
