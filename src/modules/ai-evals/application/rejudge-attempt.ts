import { EMPLOYEE_EQUITY_TASK } from "@/modules/valuation/domain/employee-equity-task";
import { INDUSTRY_RESOLUTION_TASK } from "@/modules/valuation/domain/industry-resolution-task";
import { OPERATIONS_MIX_TASK } from "@/modules/valuation/domain/operations-mix-task";

import type { EvalCase } from "../domain/eval-cases";
import type { EvalAttempt } from "../domain/eval-scoring";

/**
 * Vuelve a juzgar una medición con la policy vigente (`F5-07`, ADR 0035,
 * decisión 7): un cambio de policy se mide sobre las salidas ya grabadas, sin
 * una llamada más. Sólo cambia lo que la policy decidió; una salida que no
 * llegó o no validó el schema queda como estaba.
 */
export function rejudgeAttempt(
  evalCase: EvalCase,
  attempt: EvalAttempt,
): EvalAttempt {
  const judged = ["accepted", "abstained", "policy_rejected"].includes(
    attempt.outcome,
  );

  if (!judged || attempt.output === null) return attempt;

  const judgement =
    evalCase.task === "industry"
      ? INDUSTRY_RESOLUTION_TASK.judge(
          INDUSTRY_RESOLUTION_TASK.output.schema.parse(attempt.output),
          evalCase.input,
        )
      : evalCase.task === "employee-equity"
        ? EMPLOYEE_EQUITY_TASK.judge(
            EMPLOYEE_EQUITY_TASK.output.schema.parse(attempt.output),
            evalCase.input,
          )
        : OPERATIONS_MIX_TASK.judge(
            OPERATIONS_MIX_TASK.output.schema.parse(attempt.output),
            evalCase.input,
          );

  switch (judgement.verdict) {
    case "accept":
      return { ...attempt, outcome: "accepted", detail: null };
    case "abstain":
      return { ...attempt, outcome: "abstained", detail: judgement.reason };
    case "reject":
      return { ...attempt, outcome: "policy_rejected", detail: judgement.code };
  }
}
