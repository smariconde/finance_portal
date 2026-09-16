import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import {
  calendarDateSchema,
  contentHashSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { observationSubjectTypeSchema } from "./observation";

/**
 * Documento de fuente: el evento inmutable que publicó una o más observaciones
 * (`docs/data/point-in-time-contract.md`, sección "Eventos").
 *
 * Para la SEC es una presentación: la accession, el formulario, la fecha de
 * filing, el instante de aceptación y el foco fiscal que declara. La observación
 * guarda sólo `source_document_id`; lo que describe al documento vive acá una vez,
 * en vez de repetirse en cada uno de los miles de hechos que trae.
 *
 * Inmutable a propósito: un documento ya registrado no se reescribe. Si otra
 * corrida describe la misma accession de otra forma, eso es un conflicto que se
 * reporta, no una corrección que se aplica en silencio.
 */
export const sourceDocumentSchema = z
  .object({
    sourceId: sourceIdSchema,
    sourceDocumentId: z.string().trim().min(1).max(256),
    /** Tipo de documento en el vocabulario de la fuente: `10-K`, `10-Q/A`. */
    documentType: z.string().trim().min(1).max(32),
    subjectType: observationSubjectTypeSchema,
    subjectId: z.uuid(),
    /** Fecha calendaria de publicación que asigna la fuente (filing date). */
    publishedOn: calendarDateSchema.nullable(),
    /** Instante de aceptación, cuando la fuente lo publica. */
    acceptedAt: utcTimestampSchema.nullable(),
    availableAt: utcTimestampSchema,
    /** Regla versionada que decidió `availableAt`: nunca un default implícito. */
    availabilityRule: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:[.\-_][a-z0-9]+)*$/u),
    /** Cierre del período que el documento reporta (report date). */
    periodEndOn: calendarDateSchema.nullable(),
    fiscalYear: z.number().int().min(1900).max(2200).nullable(),
    fiscalPeriod: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,4}$/u)
      .nullable(),
    contentHash: contentHashSchema,
    /** Corrida que registró el documento por primera vez (`TM-16`). */
    ingestionRunId: z.uuid(),
    recordedAt: utcTimestampSchema,
  })
  .superRefine((document, context) => {
    // Un documento no puede ser conocible antes de que la fuente lo aceptara:
    // sería el `future_knowledge` del contrato aplicado al evento.
    if (
      document.acceptedAt !== null &&
      Date.parse(document.availableAt) < Date.parse(document.acceptedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["availableAt"],
        message: "availableAt must not precede acceptedAt.",
      });
    }
  });

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export type SourceDocumentContent = Omit<
  SourceDocument,
  "contentHash" | "ingestionRunId" | "recordedAt"
>;

/**
 * Hash del contenido del documento. Deja afuera la corrida y el instante de
 * registro: la misma presentación descrita por dos corridas es el mismo
 * documento y debe hashear igual.
 */
export function computeSourceDocumentContentHash(
  content: SourceDocumentContent,
): string {
  return computeContentHash({
    sourceId: content.sourceId,
    sourceDocumentId: content.sourceDocumentId,
    documentType: content.documentType,
    subjectType: content.subjectType,
    subjectId: content.subjectId,
    publishedOn: content.publishedOn,
    acceptedAt:
      content.acceptedAt === null
        ? null
        : new Date(content.acceptedAt).toISOString(),
    availableAt: new Date(content.availableAt).toISOString(),
    availabilityRule: content.availabilityRule,
    periodEndOn: content.periodEndOn,
    fiscalYear: content.fiscalYear,
    fiscalPeriod: content.fiscalPeriod,
  });
}
