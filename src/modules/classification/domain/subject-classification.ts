import { z } from "zod";

import {
  isEffectiveAt,
  isKnownAt,
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { TemporalContractError } from "@/modules/temporal/domain/temporal-error";

/**
 * Una clasificación es una **aserción fechada de una fuente sobre un sujeto**,
 * con taxonomía, versión y vigencia ([ADR 0025](../../../../docs/architecture/adr/0025-declared-sector-classification.md)).
 * No es una columna de la entidad.
 *
 * El motivo es que van a convivir al menos tres respuestas distintas a «qué tipo
 * de empresa es ésta», y no son la misma pregunta: el **sector** de las matrices
 * (`F7-02`), el **arquetipo** de valuación (`F3-01`) y la **industria** del
 * dataset de Damodaran (`F3-05`). Un REIT es `Real Estate` para la primera,
 * `REIT` para la segunda y otra cosa para la tercera. Una columna en
 * `legal_entity` obligaría a elegir cuál de las tres pierde; una tabla de
 * aserciones las deja convivir sin negociar.
 *
 * Por eso esta tabla es **agnóstica de taxonomía**: sumar el SIC de la SEC, el
 * arquetipo o las industrias de Damodaran es insertar filas con otra
 * `taxonomyId`, no migrar un schema.
 */
export const taxonomyIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

/**
 * Versión de la taxonomía: identifica **qué release de la fuente** hizo la
 * aserción. Para la taxonomía del paquete PDDL es el commit pineado, que es a la
 * vez reproducible y revisable en un diff.
 */
export const taxonomyVersionSchema = z.string().trim().min(1).max(128);

/**
 * Código dentro de la taxonomía. Es el valor estable; la etiqueta es para leer.
 * Se normaliza a kebab-case para que dos fuentes que escriben distinto el mismo
 * sector no produzcan dos códigos.
 */
export const classificationCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const classificationSubjectTypeSchema = z.enum([
  "legal_entity",
  "security",
  "listing",
]);

export type ClassificationSubjectType = z.infer<
  typeof classificationSubjectTypeSchema
>;

export const subjectClassificationSchema = z
  .object({
    ...temporalVersionShape,
    classificationAssignmentId: z.uuid(),
    subjectType: classificationSubjectTypeSchema,
    subjectId: z.uuid(),
    taxonomyId: taxonomyIdSchema,
    taxonomyVersion: taxonomyVersionSchema,
    code: classificationCodeSchema,
    label: z.string().trim().min(1).max(128),
  })
  .superRefine(refineTemporalVersion);

export type SubjectClassification = z.infer<typeof subjectClassificationSchema>;

/** Vigente y no superseded: la aserción que hoy vale para ese sujeto. */
export function isOpenClassification(
  classification: SubjectClassification,
): boolean {
  return (
    classification.validTo === null && classification.supersededAt === null
  );
}

/**
 * Motivo por el que un sujeto no tiene clasificación en el corte. Es `null` con
 * nombre y nunca un sector por defecto: un cajón «Otros» convertiría «no sé» en
 * un grupo, y la matriz lo dibujaría como si fuera una respuesta.
 */
export type ClassificationAbsence =
  /** El sujeto nunca fue clasificado en esta taxonomía. */
  | "never_classified"
  /** Hay aserciones, pero ninguna es efectiva y conocida en el corte. */
  | "not_effective_at_cutoff";

export type ClassificationResolution =
  | {
      readonly classified: true;
      readonly classification: SubjectClassification;
    }
  | { readonly classified: false; readonly absence: ClassificationAbsence };

/**
 * Resuelve la clasificación de un sujeto en una taxonomía al corte pedido.
 *
 * Dos aserciones vigentes a la vez en la misma taxonomía no se desempatan por
 * orden de inserción: son el conflicto que la base ya impide con un índice
 * único, y si aparecen igual se declaran.
 */
export function resolveClassificationAt(
  classifications: readonly SubjectClassification[],
  taxonomyId: string,
  query: PointInTimeQuery,
  subjectId: string,
): ClassificationResolution {
  const inTaxonomy = classifications.filter(
    (classification) =>
      classification.taxonomyId === taxonomyId &&
      classification.subjectId === subjectId,
  );

  if (inTaxonomy.length === 0) {
    return { classified: false, absence: "never_classified" };
  }

  const matches = inTaxonomy.filter(
    (classification) =>
      isEffectiveAt(classification, query.effectiveAt) &&
      isKnownAt(classification, query),
  );

  if (matches.length > 1) {
    throw new TemporalContractError(
      "overlapping_effective_versions",
      "More than one classification is effective for the subject in this taxonomy.",
      [subjectId],
    );
  }

  const match = matches[0];

  if (match === undefined) {
    return { classified: false, absence: "not_effective_at_cutoff" };
  }

  return { classified: true, classification: match };
}
