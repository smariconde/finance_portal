import { z } from "zod";

/**
 * Contrato de consulta point-in-time. La política de revisión y la basis de
 * conocimiento son explícitas y excluyentes: no existe un default silencioso
 * entre la vista original y la restated
 * (`docs/data/point-in-time-contract.md`, `TM-06`).
 */
export const knowledgeBasisSchema = z.enum([
  /** Qué podía conocer un observador según la publicación de la fuente. */
  "public_availability",
  /** Qué había registrado efectivamente esta instalación. */
  "system_recorded",
]);

export type KnowledgeBasis = z.infer<typeof knowledgeBasisSchema>;

export const adjustmentPolicySchema = z.enum(["as_known", "latest_adjusted"]);

const utcTimestampSchema = z.iso.datetime({ offset: true });

const queryBaseShape = {
  effectiveAt: utcTimestampSchema,
  adjustmentPolicy: adjustmentPolicySchema.default("as_known"),
  sourcePolicyVersion: z.string().trim().min(1).max(64),
};

export const pointInTimeQuerySchema = z.discriminatedUnion("revisionPolicy", [
  z.object({
    ...queryBaseShape,
    revisionPolicy: z.literal("as_known"),
    /** `as_known` exige un corte finito de conocimiento. */
    knownAt: utcTimestampSchema,
    knowledgeBasis: knowledgeBasisSchema.default("public_availability"),
  }),
  z.object({
    ...queryBaseShape,
    revisionPolicy: z.literal("latest_restated"),
    /**
     * Vista actual explícita: no admite corte y no puede etiquetarse como una
     * consulta histórica.
     */
    knownAt: z.null().default(null),
    knowledgeBasis: z
      .literal("public_availability")
      .default("public_availability"),
  }),
]);

export type PointInTimeQuery = z.infer<typeof pointInTimeQuerySchema>;
export type PointInTimeQueryInput = z.input<typeof pointInTimeQuerySchema>;

export const DEFAULT_SOURCE_POLICY_VERSION = "source-policy-1.0.0";
