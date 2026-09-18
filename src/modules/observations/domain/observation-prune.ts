import { z } from "zod";

import {
  datasetIdSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";
import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { observationSubjectTypeSchema } from "./observation";

/**
 * Poda de historia publicada (ADR 0019).
 *
 * El contrato point-in-time es append-only: una observación publicada no se
 * reescribe. Borrarla es otra cosa —no cambia ningún valor, saca filas enteras—
 * y por eso necesita su propio registro. Sin él la base miente: una corrida que
 * fue a buscar desde 2006 quedaría sin filas anteriores a 2020, y nada
 * distinguiría eso de un filer que no reportó (`TM-16`, ADR 0017 §5).
 *
 * El registro es la contracara de `ingestion_runs.selection_anchor_on`. La
 * corrida dice hasta dónde fue a buscar; la poda dice hasta dónde quedó lo que
 * trajo. Para un sujeto podado, la respuesta a «¿por qué falta este período?» es
 * la poda, que es la afirmación más reciente y más estricta.
 *
 * El plan es genérico a propósito: un corte por fin de período, y un corte más
 * ancho para una lista de conceptos que son evidencia de otra regla. Qué ancla
 * ese corte lo decide cada fuente; para la SEC, `plan-sec-history-prune.ts`.
 */
export const OBSERVATION_PRUNE_ACTOR_PATTERN = /^[A-Za-z0-9._:@/-]{1,128}$/u;

const actorSchema = z.string().trim().regex(OBSERVATION_PRUNE_ACTOR_PATTERN);

/** Motivo del owner, con el mismo techo que el de una acción manual sobre un job. */
const reasonSchema = z.string().trim().min(1).max(240);

const ruleVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:[.\-_][a-z0-9]+)*$/u,
    "ruleVersion must be a stable lowercase identifier.",
  );

/**
 * Qué borra una poda: las filas del sujeto, de esa fuente y ese dataset, cuyo
 * fin de período cae antes del corte. Los conceptos de evidencia usan su propio
 * corte, que nunca es más nuevo que el general.
 *
 * El corte es **estricto**: `as_of < periodsEndingBefore` se borra y
 * `as_of >= periodsEndingBefore` queda, exactamente al revés de la ventana que
 * gobierna la ingesta, para que las dos reglas no puedan discrepar en el borde.
 */
export const observationPrunePlanSchema = z
  .object({
    sourceId: sourceIdSchema,
    datasetId: datasetIdSchema,
    subjectType: observationSubjectTypeSchema,
    subjectId: z.uuid(),
    periodsEndingBefore: calendarDateSchema,
    evidencePeriodsEndingBefore: calendarDateSchema,
    /** Conceptos calificados que conservan el corte más ancho. */
    evidenceConcepts: z
      .array(z.string().trim().min(1).max(128))
      .max(64)
      .default([]),
  })
  .superRefine((plan, context) => {
    if (plan.evidencePeriodsEndingBefore > plan.periodsEndingBefore) {
      context.addIssue({
        code: "custom",
        path: ["evidencePeriodsEndingBefore"],
        message:
          "The evidence cut must not be newer than the general cut: evidence keeps more history, never less.",
      });
    }

    if (new Set(plan.evidenceConcepts).size !== plan.evidenceConcepts.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceConcepts"],
        message: "evidenceConcepts must not repeat a concept.",
      });
    }
  });

export type ObservationPrunePlan = z.infer<typeof observationPrunePlanSchema>;

export const observationPruneCountsSchema = z
  .object({
    deleted: z.number().int().min(0),
    kept: z.number().int().min(0),
    /** Extremos de lo borrado; nulos exactamente cuando no se borró nada. */
    deletedMinAsOf: calendarDateSchema.nullable(),
    deletedMaxAsOf: calendarDateSchema.nullable(),
  })
  .superRefine((counts, context) => {
    const empty = counts.deleted === 0;

    if (empty !== (counts.deletedMinAsOf === null)) {
      context.addIssue({
        code: "custom",
        path: ["deletedMinAsOf"],
        message:
          "deletedMinAsOf must be present exactly when rows were pruned.",
      });
    }

    if (empty !== (counts.deletedMaxAsOf === null)) {
      context.addIssue({
        code: "custom",
        path: ["deletedMaxAsOf"],
        message:
          "deletedMaxAsOf must be present exactly when rows were pruned.",
      });
    }

    if (
      counts.deletedMinAsOf !== null &&
      counts.deletedMaxAsOf !== null &&
      counts.deletedMinAsOf > counts.deletedMaxAsOf
    ) {
      context.addIssue({
        code: "custom",
        path: ["deletedMaxAsOf"],
        message: "deletedMaxAsOf must not precede deletedMinAsOf.",
      });
    }
  });

export type ObservationPruneCounts = z.infer<
  typeof observationPruneCountsSchema
>;

/**
 * Fila de auditoría de una poda aplicada. Append-only: describe un borrado que
 * ya ocurrió y nunca se reescribe.
 */
export const observationPruneSchema = z
  .object({
    pruneId: z.uuid(),
    ruleVersion: ruleVersionSchema,
    sourceId: sourceIdSchema,
    datasetId: datasetIdSchema,
    subjectType: observationSubjectTypeSchema,
    subjectId: z.uuid(),
    /** Selección con la que se resolvió el ancla: la que define la ventana. */
    selectionVersion: z.string().trim().min(1).max(64),
    selectionAnchorOn: calendarDateSchema,
    /** Corrida que registró ese ancla, para que la poda se pueda rastrear. */
    anchorRunId: z.uuid(),
    periodsEndingBefore: calendarDateSchema,
    evidencePeriodsEndingBefore: calendarDateSchema,
    evidenceConcepts: z.array(z.string().trim().min(1).max(128)).max(64),
    deletedCount: z.number().int().min(0),
    keptCount: z.number().int().min(0),
    deletedMinAsOf: calendarDateSchema.nullable(),
    deletedMaxAsOf: calendarDateSchema.nullable(),
    actor: actorSchema,
    reason: reasonSchema,
    executedAt: utcTimestampSchema,
  })
  .superRefine((prune, context) => {
    observationPruneCountsSchema.parse({
      deleted: prune.deletedCount,
      kept: prune.keptCount,
      deletedMinAsOf: prune.deletedMinAsOf,
      deletedMaxAsOf: prune.deletedMaxAsOf,
    });

    if (prune.evidencePeriodsEndingBefore > prune.periodsEndingBefore) {
      context.addIssue({
        code: "custom",
        path: ["evidencePeriodsEndingBefore"],
        message:
          "The evidence cut must not be newer than the general cut: evidence keeps more history, never less.",
      });
    }

    if (prune.periodsEndingBefore > prune.selectionAnchorOn) {
      context.addIssue({
        code: "custom",
        path: ["periodsEndingBefore"],
        message: "The cut must not be newer than the anchor it comes from.",
      });
    }

    // Nada que la ventana conserva puede haberse borrado. Es la invariante que
    // hace legible el registro: si esto vale, lo que falta antes del corte es
    // esta poda y lo que falta después es la fuente.
    if (
      prune.deletedMaxAsOf !== null &&
      prune.deletedMaxAsOf >= prune.periodsEndingBefore
    ) {
      context.addIssue({
        code: "custom",
        path: ["deletedMaxAsOf"],
        message: "A pruned row must end before the general cut.",
      });
    }
  });

export type ObservationPrune = z.infer<typeof observationPruneSchema>;

/** El corte que le toca a un concepto: el de evidencia, o el general. */
export function pruneCutFor(
  plan: ObservationPrunePlan,
  concept: string,
): string {
  return plan.evidenceConcepts.includes(concept)
    ? plan.evidencePeriodsEndingBefore
    : plan.periodsEndingBefore;
}

/** `true` cuando la fila queda afuera de la ventana y la poda la borra. */
export function isPruned(
  plan: ObservationPrunePlan,
  row: { readonly concept: string; readonly asOf: string },
): boolean {
  return row.asOf < pruneCutFor(plan, row.concept);
}
