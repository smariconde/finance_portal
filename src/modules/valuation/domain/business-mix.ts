import { z } from "zod";

import { BUSINESS_LINE_AXES } from "@/modules/fundamentals/domain/sec-xbrl-business-lines";

import {
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import { businessMixAbstainReasonSchema } from "./business-mix-task";

/**
 * La mezcla de negocios de una empresa (`F6-48`,
 * [ADR 0086](../../../../docs/architecture/adr/0086-business-mix-beta.md),
 * decisiones 4 a 6): la propuesta de la IA persistida, la declaración del owner
 * que la pisa, y las industrias con sus ventas que el costo de capital pondera.
 *
 * Se guarda **toda** respuesta —aceptada, abstenida o frenada— con sus líneas y
 * su evidencia. Los intentos y su costo están en el libro de gasto bajo el mismo
 * `proposalId`, que es el `task_run_id` de la escalera.
 */
export const BUSINESS_MIX_WEIGHTS_VERSION = "business-mix-weights-1.0.0";

const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const accessionSchema = z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u);

export const businessMixEvidenceSectionSchema = z.enum([
  "item_1_business",
  "xbrl_business_lines",
]);

export const businessMixEvidenceRecordSchema = z.object({
  evidenceId: z.string().regex(/^E[0-9]{1,2}$/u),
  sourceId: z.string().min(3).max(64),
  section: businessMixEvidenceSectionSchema,
  documentUrl: z.url(),
  accessionNumber: accessionSchema,
  documentAcceptedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: z.number().int().min(1),
  truncated: z.boolean(),
  excerpt: z.string().min(1),
});

export type BusinessMixEvidenceRecord = z.infer<
  typeof businessMixEvidenceRecordSchema
>;

/** Una línea elegida: el monto es el del XBRL, nunca del modelo. */
export const businessMixLineRecordSchema = z.object({
  ordinal: z.number().int().min(1).max(40),
  lineId: z.string().regex(/^L[0-9]{1,2}$/u),
  axis: z.enum(BUSINESS_LINE_AXES),
  member: z.string().min(1).max(160),
  concept: z.string().min(1).max(160),
  amount: engineDecimalSchema,
  industryKey: keySchema,
  quote: z.string().min(1).max(400),
  evidenceId: z.string().max(8),
});

export type BusinessMixLineRecord = z.infer<typeof businessMixLineRecordSchema>;

export const businessMixOutcomeSchema = z.enum([
  "accepted",
  "abstained",
  "stopped",
]);

export const businessMixProposalSchema = z
  .object({
    proposalId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: accessionSchema,
    fiscalYearEnd: z.iso.date(),
    taskVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    ladderVersion: z.string().min(1).max(64),
    linesVersion: z.string().min(1).max(64),
    sectionsVersion: z.string().min(1).max(64),
    /** La release de betas cuyas claves se ofrecieron y se validaron. */
    betasReleaseId: z.uuid(),
    outcome: businessMixOutcomeSchema,
    axis: z.enum(BUSINESS_LINE_AXES).nullable(),
    expectedRevenue: engineDecimalSchema,
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    rationale: z.string().max(2000).nullable(),
    /** Motivo de la abstención o código del freno; `null` si se aceptó. */
    reason: z.string().max(64).nullable(),
    acceptedRung: z.number().int().min(1).max(16).nullable(),
    respondedModel: z.string().max(128).nullable(),
    proposedAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((proposal, context) => {
    const accepted = proposal.outcome === "accepted";

    if (accepted === (proposal.reason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is recorded exactly when not accepted.",
      });
    }

    if (accepted !== (proposal.axis !== null)) {
      context.addIssue({
        code: "custom",
        path: ["axis"],
        message: "The axis is recorded exactly when accepted.",
      });
    }
  });

export type BusinessMixProposal = z.infer<typeof businessMixProposalSchema>;

export const KNOWN_BUSINESS_MIX_ABSTAIN_REASONS = [
  ...businessMixAbstainReasonSchema.options,
  "low_confidence",
  "ai_budget_exhausted",
  "ladder_exhausted",
] as const;

export function businessMixDocumentId(proposalId: string): string {
  return `business-mix/${proposalId}`;
}

/**
 * Lock del owner (decisión 6): por CIK, industrias con su peso —ya el del
 * valor, no el de las ventas— como fracción exacta que suma 1, y el motivo
 * escrito. Con una vigente no se le pregunta al modelo y ninguna propuesta se
 * lee.
 */
export const businessMixDeclarationSchema = z
  .object({
    cik: z.string().regex(/^[0-9]{10}$/u),
    businesses: z
      .array(z.object({ industryKey: keySchema, weight: engineDecimalSchema }))
      .min(1)
      .max(20),
    rationale: z.string().min(20).max(2000),
    declaredOn: z.iso.date(),
  })
  .superRefine((declaration, context) => {
    const weights = declaration.businesses.map((business) =>
      parseDecimal(business.weight, "weight"),
    );

    if (weights.some((weight) => !weight.greaterThan(ZERO))) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message: "Every declared weight is positive.",
      });
    }

    if (!sum(weights).equals(ONE)) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message: "Declared weights add up to exactly 1.",
      });
    }

    const keys = declaration.businesses.map((business) => business.industryKey);

    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["businesses"],
        message: "Each industry is declared once.",
      });
    }
  });

export type BusinessMixDeclaration = z.infer<
  typeof businessMixDeclarationSchema
>;

/**
 * Las ventas por industria de una propuesta aceptada, en el orden en que
 * aparecen las líneas: dos líneas de la misma industria son un negocio.
 */
export function revenueByIndustry(
  lines: readonly Pick<BusinessMixLineRecord, "industryKey" | "amount">[],
): { readonly industryKey: string; readonly revenue: string }[] {
  const totals = new Map<string, Dec>();

  for (const line of lines) {
    totals.set(
      line.industryKey,
      (totals.get(line.industryKey) ?? ZERO).plus(
        parseDecimal(line.amount, "amount"),
      ),
    );
  }

  return [...totals.entries()].map(([industryKey, revenue]) => ({
    industryKey,
    revenue: formatDecimal(revenue, "revenue"),
  }));
}
