import { z } from "zod";

/**
 * Contrato ejecutable del registro de fuentes descrito en
 * `docs/data/source-registry.md`. El estado técnico nunca eleva el estado de
 * aprobación y `unknown` falla cerrado: no equivale a permiso (`TM-15`).
 */
export const sourceIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "sourceId must be a lowercase kebab-case slug.",
  );

export const datasetIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u,
    "datasetId must be a lowercase dotted slug.",
  );

export const parserVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(
    /^[a-z0-9]+(?:[.\-_][a-z0-9]+)*$/u,
    "parserVersion must be a stable lowercase identifier.",
  );

export const rightsDecisionSchema = z.enum([
  "unknown",
  "allowed",
  "restricted",
]);

export const technicalStatusSchema = z.enum([
  "proposed",
  "technical_reviewed",
  "spike_ready",
  "integrated",
  "suspended",
]);

export const approvalStatusSchema = z.enum([
  "rights_unreviewed",
  "rights_review_pending",
  "approved_for_spike",
  "approved_personal",
  "approved_public_demo",
  "rejected",
]);

export const retentionClassSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);

export const authenticationSchema = z.enum([
  "none",
  "api_key",
  "account",
  "other",
]);

export type RightsDecision = z.infer<typeof rightsDecisionSchema>;
export type TechnicalStatus = z.infer<typeof technicalStatusSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** Cada derecho arranca en `unknown` para que omitirlo bloquee, no habilite. */
export const sourceRightsSchema = z.object({
  personalUse: rightsDecisionSchema.default("unknown"),
  automatedAccess: rightsDecisionSchema.default("unknown"),
  rawStorage: rightsDecisionSchema.default("unknown"),
  normalizedStorage: rightsDecisionSchema.default("unknown"),
  derivedStorage: rightsDecisionSchema.default("unknown"),
  publicDisplay: rightsDecisionSchema.default("unknown"),
  export: rightsDecisionSchema.default("unknown"),
  aiTransfer: rightsDecisionSchema.default("unknown"),
});

export type SourceRights = z.infer<typeof sourceRightsSchema>;

const utcTimestampSchema = z.iso.datetime({ offset: true });
const shortTextSchema = z.string().trim().min(1).max(256);

export const sourceRegistryEntrySchema = z
  .object({
    sourceId: sourceIdSchema,
    displayName: shortTextSchema,
    owner: shortTextSchema,
    canonicalUrl: z.url(),
    documentationUrls: z.array(z.url()).max(16),
    datasets: z.array(datasetIdSchema).max(32),
    endpoints: z.array(z.string().trim().min(1).max(512)).max(32),
    authentication: authenticationSchema,
    applicablePlan: shortTextSchema.nullable(),
    rateLimit: shortTextSchema.nullable(),
    attribution: shortTextSchema.nullable(),
    expectedCadence: shortTextSchema,
    freshnessTarget: shortTextSchema,
    timezone: shortTextSchema.nullable(),
    units: z.array(shortTextSchema).max(32),
    currencies: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/u),
      )
      .max(16),
    parserVersion: parserVersionSchema.nullable(),
    fixturePolicy: z.string().trim().min(1).max(512),
    fallbackSourceIds: z.array(sourceIdSchema).max(8),
    rights: sourceRightsSchema,
    technicalStatus: technicalStatusSchema,
    approvalStatus: approvalStatusSchema,
    reviewedAt: utcTimestampSchema.nullable(),
    rightsReviewedAt: utcTimestampSchema.nullable(),
    rightsReviewDueAt: utcTimestampSchema.nullable(),
    reviewEvidence: z.array(z.string().trim().min(1).max(512)).max(32),
    retentionClasses: z.array(retentionClassSchema).max(5),
    quotaPolicyId: shortTextSchema.nullable(),
    ownerNotes: z.string().trim().max(2048),
    recordedAt: utcTimestampSchema,
  })
  .superRefine((entry, context) => {
    if (
      entry.approvalStatus.startsWith("approved") &&
      entry.rightsReviewedAt === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["rightsReviewedAt"],
        message: "An approved source requires a recorded rights review date.",
      });
    }

    if (
      entry.approvalStatus === "approved_public_demo" &&
      entry.rights.publicDisplay !== "allowed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["rights", "publicDisplay"],
        message:
          "approved_public_demo requires publicDisplay rights to be allowed.",
      });
    }

    if (!entry.fallbackSourceIds.every((id) => id !== entry.sourceId)) {
      context.addIssue({
        code: "custom",
        path: ["fallbackSourceIds"],
        message: "A source cannot be its own fallback.",
      });
    }
  });

export type SourceRegistryEntry = z.infer<typeof sourceRegistryEntrySchema>;

export const ingestionRightsRequestSchema = z.object({
  /** La corrida conserva el payload original de la fuente. */
  storesRawPayload: z.boolean(),
  /** La corrida persiste valores normalizados o derivados. */
  storesNormalizedValues: z.boolean(),
  /** El resultado se mostrará en una superficie anónima. */
  publicDisplay: z.boolean(),
});

export type IngestionRightsRequest = z.infer<
  typeof ingestionRightsRequestSchema
>;

export type RightsEvaluation = {
  allowed: boolean;
  /** Códigos estables y auditables; nunca texto libre (`TM-16`). */
  blockedBy: string[];
};

const AUTOMATABLE_TECHNICAL_STATUSES: ReadonlySet<TechnicalStatus> = new Set([
  "spike_ready",
  "integrated",
]);

const AUTOMATABLE_APPROVAL_STATUSES: ReadonlySet<ApprovalStatus> = new Set([
  "approved_for_spike",
  "approved_personal",
  "approved_public_demo",
]);

/**
 * Gate fail-closed que decide si una corrida de ingesta puede siquiera contactar
 * la fuente. Se evalúa antes del provider: una fuente sin derechos revisados no
 * genera tráfico, no sólo deja de persistir.
 */
export function evaluateIngestionRights(
  entry: SourceRegistryEntry,
  request: IngestionRightsRequest,
): RightsEvaluation {
  const parsedRequest = ingestionRightsRequestSchema.parse(request);
  const blockedBy: string[] = [];

  if (!AUTOMATABLE_TECHNICAL_STATUSES.has(entry.technicalStatus)) {
    blockedBy.push(`technical_status:${entry.technicalStatus}`);
  }

  if (!AUTOMATABLE_APPROVAL_STATUSES.has(entry.approvalStatus)) {
    blockedBy.push(`approval_status:${entry.approvalStatus}`);
  }

  const requiredRights: Array<keyof SourceRights> = [
    "personalUse",
    "automatedAccess",
  ];

  if (parsedRequest.storesRawPayload) {
    requiredRights.push("rawStorage");
  }

  if (parsedRequest.storesNormalizedValues) {
    requiredRights.push("normalizedStorage");
  }

  if (parsedRequest.publicDisplay) {
    requiredRights.push("publicDisplay");
  }

  for (const right of requiredRights) {
    if (entry.rights[right] !== "allowed") {
      blockedBy.push(`rights.${right}:${entry.rights[right]}`);
    }
  }

  if (
    parsedRequest.publicDisplay &&
    entry.approvalStatus !== "approved_public_demo"
  ) {
    blockedBy.push("public_display_requires_approved_public_demo");
  }

  return { allowed: blockedBy.length === 0, blockedBy };
}
