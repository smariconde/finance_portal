import { z } from "zod";

import { computeContentHash } from "./content-hash";
import { datasetIdSchema, sourceIdSchema } from "./source-registry-entry";

/**
 * Envelope mínimo que una fuente debe entregar para pasar staging, derivado del
 * "contrato de observación" de `docs/data/source-registry.md`. Todavía no es una
 * observación publicada: identidad interna, revisión y `recorded_at` se asignan
 * en la publicación (`F1-04`).
 */
export const rawValueStatusSchema = z.enum([
  "stored",
  "not_provided",
  "license_restricted",
]);

export const periodTypeSchema = z.enum([
  "instant",
  "daily",
  "monthly",
  "quarter",
  "annual",
  "ttm",
]);

const utcTimestampSchema = z.iso.datetime({ offset: true });
const calendarDateSchema = z.iso.date();

/**
 * Los valores viajan como string decimal: un `number` de JavaScript no puede
 * representar todos los importes reportados sin pérdida y el hash canónico debe
 * reflejar exactamente lo publicado por la fuente.
 */
const decimalStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u,
    "value must be a canonical decimal string.",
  );

export const stagedRecordSchema = z
  .object({
    externalId: z.string().trim().min(1).max(256),
    concept: z.string().trim().min(1).max(128),
    subjectKey: z.string().trim().min(1).max(128),
    metricId: z.string().trim().min(1).max(128),
    asOf: calendarDateSchema,
    periodStart: calendarDateSchema.nullable(),
    periodEnd: calendarDateSchema.nullable(),
    periodType: periodTypeSchema,
    unit: z.string().trim().min(1).max(32),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    rawValue: decimalStringSchema.nullable(),
    rawValueStatus: rawValueStatusSchema,
    availableAt: utcTimestampSchema,
    sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
    qualityFlags: z.array(z.string().trim().min(1).max(64)).max(16),
  })
  .superRefine((record, context) => {
    // Un valor ausente conserva su motivo; nunca se repara con cero.
    if ((record.rawValue !== null) !== (record.rawValueStatus === "stored")) {
      context.addIssue({
        code: "custom",
        path: ["rawValue"],
        message: "rawValue must be present only when rawValueStatus is stored.",
      });
    }

    if (record.periodType === "instant") {
      if (record.periodStart !== null || record.periodEnd !== null) {
        context.addIssue({
          code: "custom",
          path: ["periodStart"],
          message: "An instant observation has no period interval.",
        });
      }
    } else if (record.periodStart === null || record.periodEnd === null) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "A period observation requires periodStart and periodEnd.",
      });
    } else if (record.periodStart > record.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "periodEnd must not precede periodStart.",
      });
    }
  });

export type StagedRecord = z.infer<typeof stagedRecordSchema>;

export const stagedBatchIdentitySchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  parserVersion: z.string().trim().min(1).max(32),
});

export type StagedBatchIdentity = z.infer<typeof stagedBatchIdentitySchema>;

/**
 * Hash canónico del lote aceptado. Incluye parser version y provenance porque
 * una corrección de parser sobre el mismo payload es contenido distinto.
 */
export function computeStagedBatchHash(
  identity: StagedBatchIdentity,
  records: readonly StagedRecord[],
): string {
  const parsedIdentity = stagedBatchIdentitySchema.parse(identity);

  return computeContentHash({
    sourceId: parsedIdentity.sourceId,
    datasetId: parsedIdentity.datasetId,
    parserVersion: parsedIdentity.parserVersion,
    records: [...records]
      .map((record) => stagedRecordSchema.parse(record))
      .sort((left, right) =>
        left.externalId < right.externalId
          ? -1
          : left.externalId > right.externalId
            ? 1
            : 0,
      ),
  });
}
