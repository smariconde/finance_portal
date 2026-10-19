import { z } from "zod";

import type { ClassificationPlan } from "@/modules/classification/domain/plan-sector-classification";
import {
  isOpenClassification,
  subjectClassificationSchema,
  type SubjectClassification,
} from "@/modules/classification/domain/subject-classification";

import { industryAbstainReasonSchema } from "./industry-resolution-task";

/**
 * Una resolución de industria persistida (`F5-03` y `F5-06` para este caso,
 * [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 7).
 *
 * Se guarda **toda** respuesta —resuelta, abstenida o frenada— con su
 * evidencia: el extracto, su hash y el documento de la SEC del que salió. Los
 * intentos y su costo ya están en el libro de gasto bajo el mismo
 * `resolutionId`, que es el `task_run_id` de la escalera.
 *
 * Sólo una resolución aceptada se publica como aserción, en la taxonomía
 * `damodaran-industry`, con `availableAt` igual al instante en que se resolvió:
 * una consulta anterior no la ve. Valuar o evaluar de nuevo lee esa aserción y
 * nunca vuelve a llamar al modelo.
 */
export const DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY = "damodaran-industry";
export const INDUSTRY_ASSERTION_RULE_VERSION = "industry-assertion-1.0.0";
/** La fuente de la aserción es el proveedor que propuso la respuesta. */
export const INDUSTRY_RESOLUTION_SOURCE_ID = "openrouter";

/**
 * Un extracto que viajó al modelo. Desde `F5-04` puede ser un resultado de
 * búsqueda web (`web_search`, de `tavily`): su `documentUrl` es la procedencia
 * que nunca se abrió, y no tiene `accession` ni instante de aceptación.
 */
export const industryEvidenceRecordSchema = z
  .object({
    evidenceId: z.string().regex(/^E[0-9]{1,2}$/u),
    sourceId: z.string().min(3).max(64),
    section: z.enum(["item_1_business", "segment_note", "web_search"]),
    documentUrl: z.url(),
    accessionNumber: z
      .string()
      .regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u)
      .nullable(),
    documentAcceptedAt: z.iso.datetime({ offset: true }).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    byteLength: z.number().int().min(1),
    truncated: z.boolean(),
    excerpt: z.string().min(1),
  })
  .superRefine((record, context) => {
    const web = record.section === "web_search";

    if (
      web !== (record.accessionNumber === null) ||
      web !== (record.documentAcceptedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["accessionNumber"],
        message: "A filing excerpt names its filing; a web result has none.",
      });
    }
  });

export type IndustryEvidenceRecord = z.infer<
  typeof industryEvidenceRecordSchema
>;

export const industryResolutionOutcomeSchema = z.enum([
  "resolved",
  "abstained",
  "stopped",
]);

export const industryResolutionRecordSchema = z
  .object({
    resolutionId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    sic: z.string().regex(/^[0-9]{4}$/u),
    candidates: z.array(z.string()).min(2).max(16),
    taskVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    ladderVersion: z.string().min(1).max(64),
    sectionsVersion: z.string().min(1).max(64),
    outcome: industryResolutionOutcomeSchema,
    industryKey: z.string().max(64).nullable(),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    rationale: z.string().max(2000).nullable(),
    /** Motivo de la abstención o código del freno; `null` si resolvió. */
    reason: z.string().max(64).nullable(),
    acceptedRung: z.number().int().min(1).max(16).nullable(),
    respondedModel: z.string().max(128).nullable(),
    citedEvidenceIds: z.array(z.string()).max(8),
    resolvedAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    const resolved = record.outcome === "resolved";

    if (resolved !== (record.industryKey !== null)) {
      context.addIssue({
        code: "custom",
        path: ["industryKey"],
        message: "An industry key is recorded exactly when resolved.",
      });
    }

    if (resolved === (record.reason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is recorded exactly when not resolved.",
      });
    }

    if (resolved && !record.candidates.includes(record.industryKey!)) {
      context.addIssue({
        code: "custom",
        path: ["industryKey"],
        message: "A resolved industry must be one of the candidates.",
      });
    }
  });

export type IndustryResolutionRecord = z.infer<
  typeof industryResolutionRecordSchema
>;

/** Los motivos que la abstención de la tarea puede dar, además de la policy. */
export const KNOWN_ABSTAIN_REASONS = [
  ...industryAbstainReasonSchema.options,
  "low_confidence",
  "ai_budget_exhausted",
  "ladder_exhausted",
] as const;

export function industryResolutionDocumentId(resolutionId: string): string {
  return `industry-resolution/${resolutionId}`;
}

/**
 * Plan de la aserción de una resolución aceptada. La misma clave que la vigente
 * no abre nada: la industria no cambió, y la resolución nueva queda igual en su
 * tabla como evidencia de que se volvió a preguntar. Otra clave supersede en el
 * instante en que se resolvió, nunca antes.
 */
export function planIndustryAssertion(input: {
  readonly resolution: IndustryResolutionRecord;
  readonly industryLabel: string;
  /** Aserciones `damodaran-industry` guardadas, vigentes o no. */
  readonly stored: readonly SubjectClassification[];
  readonly newId: () => string;
  readonly hashContent: (input: string) => string;
}): ClassificationPlan {
  const { resolution } = input;

  if (resolution.outcome !== "resolved") {
    throw new Error("Only a resolved industry is asserted.");
  }

  const subjectId = resolution.legalEntityId;
  const open = input.stored.filter(
    (classification) =>
      classification.taxonomyId === DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY &&
      classification.subjectId === subjectId &&
      isOpenClassification(classification),
  );

  if (open.length > 1) {
    throw new Error(
      `subject ${subjectId} has more than one open industry assertion`,
    );
  }

  const current = open[0];
  const code = resolution.industryKey!;
  const base = {
    ruleVersion: INDUSTRY_ASSERTION_RULE_VERSION,
    taxonomyId: DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
    taxonomyVersion: resolution.taskVersion,
    rejections: [],
  };

  if (current !== undefined && current.code === code) {
    return {
      ...base,
      opened: [],
      supersessions: [],
      counts: {
        claims: 1,
        opened: 0,
        superseded: 0,
        unchanged: 1,
        rejected: 0,
        notReasserted: 0,
      },
    };
  }

  if (
    current !== undefined &&
    Date.parse(resolution.resolvedAt) <= Date.parse(current.availableAt)
  ) {
    throw new Error(
      `industry resolution for ${subjectId} does not follow the stored assertion`,
    );
  }

  const opened = subjectClassificationSchema.parse({
    classificationAssignmentId: input.newId(),
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
    taxonomyVersion: resolution.taskVersion,
    code,
    label: input.industryLabel.slice(0, 128),
    validFrom: resolution.resolvedAt,
    validTo: null,
    availableAt: resolution.resolvedAt,
    supersededAt: null,
    sourceId: INDUSTRY_RESOLUTION_SOURCE_ID,
    sourceDocumentId: industryResolutionDocumentId(resolution.resolutionId),
    contentHash: input.hashContent(
      `${DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY}|${subjectId}|${code}|${resolution.resolutionId}`,
    ),
    recordedAt: resolution.recordedAt,
  });

  return {
    ...base,
    opened: [opened],
    supersessions:
      current === undefined
        ? []
        : [
            {
              subjectId,
              validFrom: current.validFrom,
              supersededAt: resolution.resolvedAt,
              previousCode: current.code,
              nextCode: code,
            },
          ],
    counts: {
      claims: 1,
      opened: 1,
      superseded: current === undefined ? 0 : 1,
      unchanged: 0,
      rejected: 0,
      notReasserted: 0,
    },
  };
}
