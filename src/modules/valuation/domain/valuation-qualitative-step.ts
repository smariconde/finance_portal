import { z } from "zod";

import { isExcessReturnProfile } from "./asset-profile";
import type { MethodSelection } from "./method-selection";

/**
 * Lo que la corrida le preguntó a la IA antes de valuar (`F6-13`,
 * [ADR 0052](../../../../docs/architecture/adr/0052-qualitative-decisions-in-valuation-job.md)).
 *
 * `valuation-qualitative-1.0.0` nombra tres tareas —industria ambigua,
 * opciones de empleados y mix de operaciones— y registra, por cada una, qué
 * encontró el job y qué hizo. Es un registro, no un plan. La IA propone y la
 * policy de cada tarea decide; este archivo no lee un reloj ni sale a la red.
 */
/**
 * `1.1.0` (`F6-48`, ADR 0086): una cuarta tarea, la mezcla de negocios, después
 * del mix de operaciones. Un registro `1.0.0` no la trae y se sigue leyendo.
 */
export const VALUATION_QUALITATIVE_RULE_VERSION = "valuation-qualitative-1.1.0";
const READABLE_RULE_VERSIONS = [
  "valuation-qualitative-1.0.0",
  VALUATION_QUALITATIVE_RULE_VERSION,
] as const;

export const qualitativeTaskSchema = z.enum([
  "industry",
  "employeeEquity",
  "operationsMix",
  "businessMix",
]);

export type QualitativeTask = z.infer<typeof qualitativeTaskSchema>;

/**
 * El orden en que se pregunta: la industria mueve el WACC, el mix de
 * operaciones afina el CRP y la mezcla de negocios la beta.
 */
export const QUALITATIVE_TASK_ORDER: readonly QualitativeTask[] = [
  "industry",
  "employeeEquity",
  "operationsMix",
  "businessMix",
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
  ruleVersion: z.enum(READABLE_RULE_VERSIONS),
  industry: qualitativeTaskStepSchema,
  employeeEquity: qualitativeTaskStepSchema,
  operationsMix: qualitativeTaskStepSchema,
  /** Ausente en un registro `1.0.0`. */
  businessMix: qualitativeTaskStepSchema.optional(),
  /** Lo cobrado por las tareas, en nano-dólares; el libro de gasto tiene el detalle. */
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
    (task) => step[task]?.status === "accepted",
  );
}

type SelectionForQualitative = Pick<
  MethodSelection,
  | "status"
  | "assetProfile"
  | "recommendedMethod"
  | "requiredInputs"
  | "unsupportedReasons"
>;

const FCFF_ASKING_METHODS: ReadonlySet<string> = new Set([
  "fcff_base",
  "normalized_fcff",
  "excess_return",
]);

const GROWTH_METHODS: ReadonlySet<string> = new Set([
  "fcff_three_stage",
  "revenue_margin_survival",
]);

/**
 * Una cíclica a la que sólo le falta la historia del ciclo (`F6-18`): la
 * historia necesita el costo de capital, y éste puede necesitar la industria.
 */
export function awaitsCycleHistory(
  selection: SelectionForQualitative,
): boolean {
  return (
    selection.recommendedMethod === "normalized_fcff" &&
    selection.unsupportedReasons.length === 1 &&
    selection.unsupportedReasons[0] === "missing_required_input" &&
    selection.requiredInputs.length === 1 &&
    selection.requiredInputs[0] === "cycle_margins"
  );
}

/**
 * Pérdidas o alto crecimiento (`F6-21`) a los que sólo les faltan insumos: la
 * trayectoria y el margen objetivo salen del costo de capital y de la industria
 * de Damodaran, así que un SIC ambiguo los dejaba sin camino si la IA no
 * preguntaba antes. Cualquier otro motivo de negativa no gasta.
 */
export function awaitsGrowthInputs(
  selection: SelectionForQualitative,
): boolean {
  return (
    selection.recommendedMethod !== null &&
    GROWTH_METHODS.has(selection.recommendedMethod) &&
    selection.unsupportedReasons.length === 1 &&
    selection.unsupportedReasons[0] === "missing_required_input"
  );
}

/**
 * Si el job le pregunta a la IA lo cualitativo que falta (ADR 0052): un método
 * FCFF elegido, una cíclica que espera su historia, un banco o una aseguradora
 * con exceso de retorno, o pérdidas y alto crecimiento que esperan insumos.
 */
export function asksQualitativeDecisions(
  selection: SelectionForQualitative,
): boolean {
  const financialProfile = isExcessReturnProfile(selection.assetProfile);

  if (awaitsGrowthInputs(selection)) {
    return true;
  }

  return (
    (selection.status === "selected" ||
      awaitsCycleHistory(selection) ||
      financialProfile) &&
    selection.recommendedMethod !== null &&
    FCFF_ASKING_METHODS.has(selection.recommendedMethod)
  );
}
