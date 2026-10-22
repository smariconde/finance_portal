import { z } from "zod";

/**
 * Lo que la corrida le preguntó a la IA antes de valuar (`F6-13`,
 * [ADR 0052](../../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)).
 *
 * `valuation-qualitative-1.0.0` nombra tres tareas —industria ambigua,
 * opciones de empleados y mix de operaciones— y registra, por cada una, qué
 * encontró el job y qué hizo. Es un registro, no un plan. La IA propone y la
 * policy de cada tarea decide; este archivo no lee un reloj ni sale a la red.
 */
export const VALUATION_QUALITATIVE_RULE_VERSION = "valuation-qualitative-1.0.0";

export const qualitativeTaskSchema = z.enum([
  "industry",
  "employeeEquity",
  "operationsMix",
]);

export type QualitativeTask = z.infer<typeof qualitativeTaskSchema>;

/** El orden en que se pregunta: la industria mueve el WACC, el mix lo afina. */
export const QUALITATIVE_TASK_ORDER: readonly QualitativeTask[] = [
  "industry",
  "employeeEquity",
  "operationsMix",
];

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);

export const qualitativeTaskStepSchema = z.discriminatedUnion("status", [
  /** La evaluación ya lo tiene: no hay nada que preguntar. */
  z.object({ status: z.literal("present") }),
  /** La tarea decidió no preguntar: ya preguntó por ese 10-K, no hay nota… */
  z.object({ status: z.literal("skipped"), reason: codeSchema }),
  /** La policy aceptó la respuesta y quedó guardada. */
  z.object({
    status: z.literal("accepted"),
    rung: z.number().int().min(1).max(8),
  }),
  /** Ningún escalón dio una respuesta que la policy aceptara. */
  z.object({ status: z.literal("abstained"), reason: codeSchema }),
  /** Algo ajeno a la tarea frenó la escalera: breaker, clave, cuota. */
  z.object({ status: z.literal("stopped"), code: codeSchema }),
  /** Una tarea anterior frenó la escalera: ésta no se intentó. */
  z.object({ status: z.literal("not_run") }),
  /** La tarea lanzó: la SEC no respondió, la evidencia no puede viajar… */
  z.object({ status: z.literal("failed"), code: codeSchema }),
]);

export type QualitativeTaskStep = z.infer<typeof qualitativeTaskStepSchema>;

export const valuationQualitativeStepSchema = z.object({
  ruleVersion: z.literal(VALUATION_QUALITATIVE_RULE_VERSION),
  industry: qualitativeTaskStepSchema,
  employeeEquity: qualitativeTaskStepSchema,
  operationsMix: qualitativeTaskStepSchema,
  /** Lo cobrado por las tres tareas, en nano-dólares; el libro de gasto tiene el detalle. */
  chargedNanoUsd: z.number().int().min(0),
});

export type ValuationQualitativeStep = z.infer<
  typeof valuationQualitativeStepSchema
>;

/**
 * Si el job dejó una decisión nueva que la evaluación todavía no ve. Su
 * aserción se publica en el instante en que se aceptó, después del corte del
 * job: otro job, con corte nuevo, valúa con ella.
 */
export function qualitativeStepAccepted(
  step: ValuationQualitativeStep,
): boolean {
  return QUALITATIVE_TASK_ORDER.some(
    (task) => step[task].status === "accepted",
  );
}
