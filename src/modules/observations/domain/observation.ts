import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  datasetIdSchema,
  parserVersionSchema,
  sourceIdSchema,
} from "@/modules/ingestion/domain/source-registry-entry";
import {
  decimalStringSchema,
  periodTypeSchema,
  rawValueStatusSchema,
} from "@/modules/ingestion/domain/staged-record";
import {
  calendarDateSchema,
  contentHashSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

/**
 * Observación publicada: la forma persistida del contrato point-in-time
 * (`docs/data/point-in-time-contract.md`). A diferencia de un `StagedRecord`,
 * ya tiene sujeto interno resuelto, cadena de revisión, `recorded_at` e
 * `ingestion_run_id`, de modo que cada valor puede explicarse hasta la corrida
 * que lo publicó (`TM-16`).
 */
export const observationSubjectTypeSchema = z.enum([
  "legal_entity",
  "security",
  "listing",
  "macro_series",
]);

export type ObservationSubjectType = z.infer<
  typeof observationSubjectTypeSchema
>;

/** Base del valor: lo reportado por la fuente o una normalización versionada. */
export const valueBasisSchema = z.enum(["reported", "normalized"]);

export type ValueBasis = z.infer<typeof valueBasisSchema>;

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/u);

/**
 * Clave lógica de una observación. No incluye ticker ni parser version: el
 * ticker no es una foreign key y una corrección de parser produce otra revisión
 * del mismo hecho, no un hecho distinto.
 */
export const observationLogicalKeySchema = z.object({
  subjectType: observationSubjectTypeSchema,
  subjectId: z.uuid(),
  metricId: z.string().trim().min(1).max(128),
  concept: z.string().trim().min(1).max(128),
  asOf: calendarDateSchema,
  periodStart: calendarDateSchema.nullable(),
  periodEnd: calendarDateSchema.nullable(),
  periodType: periodTypeSchema,
  unit: z.string().trim().min(1).max(32),
  currency: currencySchema.nullable(),
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  valueBasis: valueBasisSchema,
});

export type ObservationLogicalKey = z.infer<typeof observationLogicalKeySchema>;

/**
 * El `revision_group_id` es estable por clave lógica: todas las versiones de un
 * mismo hecho comparten cadena y ninguna sobreescribe a la anterior.
 */
export function computeRevisionGroupId(key: ObservationLogicalKey): string {
  return computeContentHash(observationLogicalKeySchema.parse(key));
}

export const observationSchema = z
  .object({
    observationId: z.uuid(),
    ...observationLogicalKeySchema.shape,
    parserVersion: parserVersionSchema,
    rawValue: decimalStringSchema.nullable(),
    rawValueStatus: rawValueStatusSchema,
    /** Sólo existe cuando una transformación versionada la produjo. */
    normalizedValue: decimalStringSchema.nullable(),
    transformationId: z.string().trim().min(1).max(128).nullable(),
    availableAt: utcTimestampSchema,
    supersededAt: utcTimestampSchema.nullable(),
    fetchedAt: utcTimestampSchema,
    recordedAt: utcTimestampSchema,
    revisionGroupId: contentHashSchema,
    revisionNumber: z.number().int().min(1),
    restatementOfId: z.uuid().nullable(),
    contentHash: contentHashSchema,
    qualityFlags: z.array(z.string().trim().min(1).max(64)).max(16),
    sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
    externalId: z.string().trim().min(1).max(256),
    ingestionRunId: z.uuid(),
  })
  .superRefine((observation, context) => {
    // Un valor ausente conserva su motivo; nunca se repara con cero (`TM-05`).
    if (
      (observation.rawValue !== null) !==
      (observation.rawValueStatus === "stored")
    ) {
      context.addIssue({
        code: "custom",
        path: ["rawValue"],
        message: "rawValue must be present only when rawValueStatus is stored.",
      });
    }

    if (
      observation.normalizedValue !== null &&
      observation.transformationId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["transformationId"],
        message: "A normalized value requires a versioned transformation id.",
      });
    }

    if (observation.periodType === "instant") {
      if (observation.periodStart !== null || observation.periodEnd !== null) {
        context.addIssue({
          code: "custom",
          path: ["periodStart"],
          message: "An instant observation has no period interval.",
        });
      }
    } else if (
      observation.periodStart === null ||
      observation.periodEnd === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "A period observation requires periodStart and periodEnd.",
      });
    } else if (observation.periodStart > observation.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "periodEnd must not precede periodStart.",
      });
    }

    if (
      (observation.revisionNumber === 1) !==
      (observation.restatementOfId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["restatementOfId"],
        message:
          "Only the first revision has no restatement link; every later one has exactly one.",
      });
    }

    if (
      observation.supersededAt !== null &&
      Date.parse(observation.supersededAt) <=
        Date.parse(observation.availableAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "supersededAt must be strictly later than availableAt.",
      });
    }
  });

export type Observation = z.infer<typeof observationSchema>;

/** Flag que registra una ingesta tardía sin fingir conocimiento anticipado. */
export const LATE_INGESTION_FLAG = "late_ingestion";

/**
 * Hash de contenido de la observación. Cubre el payload publicado y la
 * provenance —incluida la parser version— porque el mismo valor obtenido con
 * otro parser es contenido distinto y debe crear una revisión, no un overwrite.
 */
export function computeObservationContentHash(input: {
  logicalKey: ObservationLogicalKey;
  parserVersion: string;
  rawValue: string | null;
  rawValueStatus: string;
  normalizedValue: string | null;
  availableAt: string;
  sourceDocumentId: string | null;
  externalId: string;
  qualityFlags: readonly string[];
}): string {
  return computeContentHash({
    logicalKey: observationLogicalKeySchema.parse(input.logicalKey),
    parserVersion: input.parserVersion,
    rawValue: input.rawValue,
    rawValueStatus: input.rawValueStatus,
    normalizedValue: input.normalizedValue,
    availableAt: input.availableAt,
    sourceDocumentId: input.sourceDocumentId,
    externalId: input.externalId,
    qualityFlags: [...input.qualityFlags].sort(),
  });
}

export function toLogicalKey(observation: Observation): ObservationLogicalKey {
  return observationLogicalKeySchema.parse(observation);
}
