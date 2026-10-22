/**
 * Si una respuesta guardada de una tarea cuenta como respuesta (`F6-13`,
 * [ADR 0052](../../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)).
 *
 * Una tarea no vuelve a preguntar por el mismo 10-K: lo que el modelo dijo
 * sobre esa evidencia no cambia por preguntar otra vez. Pero una corrida que
 * frenó algo ajeno a la tarea —el breaker, la clave, el kill switch, la cuota de
 * requests o el tope en dólares del día— no leyó la evidencia: guardarla como
 * respuesta dejaría a la empresa sin preguntar hasta un `--again` a mano.
 */
export const AI_BUDGET_EXHAUSTED_REASON = "ai_budget_exhausted";

export function isTransientAiAnswer(answer: {
  readonly outcome: string;
  readonly reason: string | null;
}): boolean {
  return (
    answer.outcome === "stopped" || answer.reason === AI_BUDGET_EXHAUSTED_REASON
  );
}
