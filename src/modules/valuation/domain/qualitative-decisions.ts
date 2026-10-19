import { z } from "zod";

import type { CostOfCapital, OperationsMixReading } from "./cost-of-capital";
import {
  engineDecimalSchema,
  ONE,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import {
  industryCandidates,
  INDUSTRY_MAPPING_VERSION,
  type IndustryDeclaration,
  type IndustryMapping,
} from "./industry-mapping";
import type {
  IndustryEvidenceRecord,
  IndustryResolutionRecord,
} from "./industry-resolution";
import {
  OPERATIONS_MIX_WEIGHTS_VERSION,
  operationsMixDeclarationSchema,
  operationsMixLineRecordSchema,
  weightsOfProposal,
  type OperationsMixDeclaration,
  type OperationsMixEvidenceRecord,
  type OperationsMixLineRecord,
  type OperationsMixProposal,
} from "./operations-mix";
import { parsePrintedAmount, quoteHolds } from "./operations-mix-task";

/**
 * Las decisiones cualitativas de una corrida, congeladas en su snapshot
 * (`F5-06`, [ADR 0007](../../../../docs/architecture/adr/0007-ticker-driven-valuation-pivot.md)
 * y [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md)).
 *
 * La industria y el mix de operaciones mueven la beta y el CRP. Pueden venir de
 * la tabla del SIC, del owner o de una propuesta de la IA aceptada por su policy,
 * y el snapshot lleva **la decisión misma**: la base, quién respondió, sobre qué
 * 10-K, con qué versiones y —para el mix— cada línea como se imprimió con su cita.
 * Los extractos no viajan: los representa su hash, y el texto queda en las
 * tablas de propuestas.
 *
 * Así el replay no depende de esas tablas ni de la escalera. El motor recalcula
 * desde acá la industria y los pesos que el costo de capital usó, y rechaza la
 * diferencia: ninguna cifra del resultado sale de texto libre del modelo, y la
 * que sale de una propuesta se puede seguir hasta su cita.
 */
/**
 * `1.1.0` (`F5-04`): la evidencia puede ser un resultado de búsqueda web, sin
 * `accession`. Un snapshot `1.0.0` se sigue leyendo igual y su hash no cambia.
 */
export const QUALITATIVE_DECISIONS_VERSION = "qualitative-decisions-1.1.0";
const READABLE_VERSIONS = [
  "qualitative-decisions-1.0.0",
  QUALITATIVE_DECISIONS_VERSION,
] as const;

const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const sicSchema = z.string().regex(/^[0-9]{4}$/u);
const accessionSchema = z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const versionSchema = z.string().min(1).max(64);

/** Un extracto mandado al modelo, sin su texto: lo identifica su hash. */
export const evidenceDigestSchema = z
  .object({
    evidenceId: z.string().regex(/^E[0-9]{1,2}$/u),
    sourceId: z.string().min(3).max(64),
    section: z.enum([
      "item_1_business",
      "segment_note",
      "geographic_revenue",
      "web_search",
    ]),
    documentUrl: z.url(),
    accessionNumber: accessionSchema.nullable(),
    documentAcceptedAt: timestampSchema.nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    byteLength: z.number().int().min(1),
    truncated: z.boolean(),
  })
  .superRefine((item, context) => {
    const web = item.section === "web_search";

    if (
      web !== (item.accessionNumber === null) ||
      web !== (item.documentAcceptedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["accessionNumber"],
        message: "A filing excerpt names its filing; a web result has none.",
      });
    }
  });

export type EvidenceDigest = z.infer<typeof evidenceDigestSchema>;

const evidenceListSchema = z
  .array(evidenceDigestSchema)
  .min(1)
  .max(8)
  .refine(
    (items) =>
      new Set(items.map((item) => item.evidenceId)).size === items.length,
    "Evidence IDs are unique.",
  );

export const industryDecisionSchema = z
  .discriminatedUnion("basis", [
    z.object({
      basis: z.literal("sic"),
      mappingVersion: versionSchema,
      industryKey: keySchema,
      sic: sicSchema,
      candidates: z.array(keySchema).length(1),
    }),
    z.object({
      basis: z.literal("owner_declaration"),
      mappingVersion: versionSchema,
      industryKey: keySchema,
      sic: sicSchema.nullable(),
      candidates: z.array(keySchema).max(16),
      declaredOn: z.iso.date(),
      rationale: z.string().trim().min(20).max(400),
    }),
    z.object({
      basis: z.literal("ai_resolution"),
      mappingVersion: versionSchema,
      industryKey: keySchema,
      sic: sicSchema,
      candidates: z.array(keySchema).min(2).max(16),
      resolution: z.object({
        resolutionId: z.uuid(),
        taskVersion: versionSchema,
        promptVersion: versionSchema,
        ladderVersion: versionSchema,
        sectionsVersion: versionSchema,
        respondedModel: z.string().min(1).max(128),
        acceptedRung: z.number().int().min(1).max(16),
        // `low` es una abstención: una resolución aceptada nunca la tiene.
        confidence: z.enum(["high", "medium"]),
        rationale: z.string().min(1).max(2000),
        citedEvidenceIds: z.array(z.string()).min(1).max(8),
        resolvedAt: timestampSchema,
        evidence: evidenceListSchema,
      }),
    }),
  ])
  .superRefine((decision, context) => {
    if (decision.basis !== "owner_declaration") {
      if (!decision.candidates.includes(decision.industryKey)) {
        context.addIssue({
          code: "custom",
          path: ["industryKey"],
          message: "The industry is one of the SIC's candidates.",
        });
      }
    }

    if (decision.basis === "ai_resolution") {
      const ids = new Set(
        decision.resolution.evidence.map((item) => item.evidenceId),
      );

      if (decision.resolution.citedEvidenceIds.some((id) => !ids.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["resolution", "citedEvidenceIds"],
          message: "Every citation names evidence carried with the decision.",
        });
      }
    }
  });

export type IndustryDecision = z.infer<typeof industryDecisionSchema>;

export const operationsMixDecisionSchema = z
  .discriminatedUnion("source", [
    z.object({
      source: z.literal("owner_declaration"),
      weightsVersion: versionSchema,
      declaredOn: z.iso.date(),
      rationale: z.string().min(20).max(2000),
      exposures: z
        .array(
          z.object({
            exposureKeys: z.array(keySchema).min(1).max(12),
            weight: engineDecimalSchema,
          }),
        )
        .min(1)
        .max(40),
    }),
    z.object({
      source: z.literal("ai_proposal"),
      weightsVersion: versionSchema,
      proposal: z.object({
        proposalId: z.uuid(),
        taskVersion: versionSchema,
        promptVersion: versionSchema,
        policyVersion: versionSchema,
        ladderVersion: versionSchema,
        extractVersion: versionSchema,
        accessionNumber: accessionSchema,
        fiscalYearEnd: z.iso.date(),
        countryReleaseId: z.uuid(),
        regionReleaseId: z.uuid(),
        unit: z.enum(["units", "thousands", "millions", "billions"]),
        printedTotal: z.string().min(1).max(32),
        expectedRevenue: engineDecimalSchema,
        confidence: z.enum(["high", "medium"]),
        respondedModel: z.string().min(1).max(128),
        acceptedRung: z.number().int().min(1).max(16),
        proposedAt: timestampSchema,
      }),
      lines: z.array(operationsMixLineRecordSchema).min(1).max(40),
      evidence: evidenceListSchema,
    }),
  ])
  .superRefine((decision, context) => {
    if (decision.source === "owner_declaration") {
      const weights = decision.exposures.map((exposure) =>
        parseDecimal(exposure.weight, "weight"),
      );

      if (
        weights.some((weight) => !weight.greaterThan(ZERO)) ||
        !sum(weights).equals(ONE)
      ) {
        context.addIssue({
          code: "custom",
          path: ["exposures"],
          message: "Declared weights are positive and add up to exactly 1.",
        });
      }

      return;
    }

    const ids = new Set(decision.evidence.map((item) => item.evidenceId));

    decision.lines.forEach((line, index) => {
      if (line.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "ordinal"],
          message: "Lines are numbered consecutively from one.",
        });
      }

      if (!ids.has(line.evidenceId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "evidenceId"],
          message: "Every line cites evidence carried with the decision.",
        });
      }
    });
  });

export type OperationsMixDecision = z.infer<typeof operationsMixDecisionSchema>;

export const qualitativeDecisionsSchema = z.object({
  version: z.enum(READABLE_VERSIONS),
  /** `null` cuando la industria no quedó mapeada: entonces no hay WACC. */
  industry: industryDecisionSchema.nullable(),
  /** `null` sin mix: el CRP es el del domicilio, nunca cero. */
  operationsMix: operationsMixDecisionSchema.nullable(),
});

export type QualitativeDecisions = z.infer<typeof qualitativeDecisionsSchema>;

function digestOf(item: {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly section: EvidenceDigest["section"];
  readonly documentUrl: string;
  readonly accessionNumber: string | null;
  readonly documentAcceptedAt: string | null;
  readonly sha256: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}): EvidenceDigest {
  return {
    evidenceId: item.evidenceId,
    sourceId: item.sourceId,
    section: item.section,
    documentUrl: item.documentUrl,
    accessionNumber: item.accessionNumber,
    documentAcceptedAt: item.documentAcceptedAt,
    sha256: item.sha256,
    byteLength: item.byteLength,
    truncated: item.truncated,
  };
}

/**
 * La decisión de industria que el mapeo tomó, con lo que la sostiene. Un mapeo
 * de la IA sin su resolución guardada no se puede explicar y se niega: no se
 * congela una industria cuyo origen se perdió.
 */
export function industryDecisionOf(
  mapping: IndustryMapping,
  sources: {
    readonly declaration: IndustryDeclaration | null;
    readonly resolution: {
      readonly resolution: IndustryResolutionRecord;
      readonly evidence: readonly IndustryEvidenceRecord[];
    } | null;
  },
): IndustryDecision | null {
  if (mapping.status !== "mapped") {
    return null;
  }

  const common = {
    mappingVersion: mapping.version,
    industryKey: mapping.industryKey,
    candidates: [...mapping.candidates],
  };

  if (mapping.basis === "sic") {
    return industryDecisionSchema.parse({
      ...common,
      basis: "sic",
      sic: mapping.sic,
    });
  }

  if (mapping.basis === "owner_declaration") {
    const declaration = sources.declaration;

    if (
      declaration === null ||
      declaration.industryKey !== mapping.industryKey
    ) {
      throw new Error("An owner-declared industry needs its declaration.");
    }

    return industryDecisionSchema.parse({
      ...common,
      basis: "owner_declaration",
      sic: mapping.sic,
      declaredOn: declaration.decidedOn,
      rationale: declaration.rationale,
    });
  }

  const stored = sources.resolution;
  const resolution = stored?.resolution;

  if (
    stored === null ||
    resolution === undefined ||
    resolution.resolutionId !== mapping.resolution?.resolutionId ||
    resolution.outcome !== "resolved" ||
    resolution.industryKey !== mapping.industryKey
  ) {
    throw new Error("An AI-resolved industry needs its stored resolution.");
  }

  return industryDecisionSchema.parse({
    ...common,
    basis: "ai_resolution",
    sic: mapping.sic,
    resolution: {
      resolutionId: resolution.resolutionId,
      taskVersion: resolution.taskVersion,
      promptVersion: resolution.promptVersion,
      ladderVersion: resolution.ladderVersion,
      sectionsVersion: resolution.sectionsVersion,
      respondedModel: resolution.respondedModel,
      acceptedRung: resolution.acceptedRung,
      confidence: resolution.confidence,
      rationale: resolution.rationale,
      citedEvidenceIds: [...resolution.citedEvidenceIds],
      resolvedAt: resolution.resolvedAt,
      evidence: stored.evidence.map(digestOf),
    },
  });
}

/** El mix declarado por el owner, tal como entra al snapshot. */
export function operationsMixDecisionOfDeclaration(
  declaration: OperationsMixDeclaration,
): OperationsMixDecision {
  const parsed = operationsMixDeclarationSchema.parse(declaration);

  return operationsMixDecisionSchema.parse({
    source: "owner_declaration",
    weightsVersion: OPERATIONS_MIX_WEIGHTS_VERSION,
    declaredOn: parsed.declaredOn,
    rationale: parsed.rationale,
    exposures: parsed.exposures,
  });
}

/** La propuesta aceptada de la IA, tal como entra al snapshot. */
export function operationsMixDecisionOfProposal(stored: {
  readonly proposal: OperationsMixProposal;
  readonly lines: readonly OperationsMixLineRecord[];
  readonly evidence: readonly OperationsMixEvidenceRecord[];
}): OperationsMixDecision {
  const { proposal } = stored;

  if (proposal.outcome !== "accepted") {
    throw new Error("Only an accepted operations mix enters a run.");
  }

  return operationsMixDecisionSchema.parse({
    source: "ai_proposal",
    weightsVersion: OPERATIONS_MIX_WEIGHTS_VERSION,
    proposal: {
      proposalId: proposal.proposalId,
      taskVersion: proposal.taskVersion,
      promptVersion: proposal.promptVersion,
      policyVersion: proposal.policyVersion,
      ladderVersion: proposal.ladderVersion,
      extractVersion: proposal.extractVersion,
      accessionNumber: proposal.accessionNumber,
      fiscalYearEnd: proposal.fiscalYearEnd,
      countryReleaseId: proposal.countryReleaseId,
      regionReleaseId: proposal.regionReleaseId,
      unit: proposal.unit,
      printedTotal: proposal.printedTotal,
      expectedRevenue: proposal.expectedRevenue,
      confidence: proposal.confidence,
      respondedModel: proposal.respondedModel,
      acceptedRung: proposal.acceptedRung,
      proposedAt: proposal.proposedAt,
    },
    lines: [...stored.lines],
    evidence: stored.evidence.map(digestOf),
  });
}

/**
 * Los pesos que el costo de capital usa, derivados de la decisión con la misma
 * regla versionada. Es la única forma de llegar de una propuesta a un peso: el
 * motor la repite al validar.
 */
export function operationsMixReadingOf(
  decision: OperationsMixDecision,
): OperationsMixReading {
  if (decision.weightsVersion !== OPERATIONS_MIX_WEIGHTS_VERSION) {
    throw new Error(`unknown weights version ${decision.weightsVersion}`);
  }

  if (decision.source === "owner_declaration") {
    return {
      source: "owner_declaration",
      proposalId: null,
      weightsVersion: decision.weightsVersion,
      exposures: decision.exposures.map((exposure) => ({
        exposureKeys: [...exposure.exposureKeys],
        basis: "owner_declaration" as const,
        weight: exposure.weight,
      })),
    };
  }

  return {
    source: "ai_proposal",
    proposalId: decision.proposal.proposalId,
    weightsVersion: decision.weightsVersion,
    exposures: weightsOfProposal(decision.lines),
  };
}

function industryMismatches(
  decision: IndustryDecision | null,
  costOfCapital: CostOfCapital,
): string[] {
  if (decision === null) {
    return ["qualitativeDecisions.industry"];
  }

  const mismatches: string[] = [];

  if (decision.mappingVersion !== INDUSTRY_MAPPING_VERSION) {
    mismatches.push("qualitativeDecisions.industry.mappingVersion");
  }

  if (decision.industryKey !== costOfCapital.industryKey) {
    mismatches.push("qualitativeDecisions.industry.industryKey");
  }

  // Las candidatas son las de la tabla del SIC: una decisión que nombra otras
  // contestó una pregunta que el código no hace.
  if (decision.basis !== "owner_declaration") {
    const expected = industryCandidates(decision.sic) ?? [];

    if (
      expected.length !== decision.candidates.length ||
      expected.some((key, index) => decision.candidates[index] !== key)
    ) {
      mismatches.push("qualitativeDecisions.industry.candidates");
    }
  }

  return mismatches;
}

function lineMismatches(decision: OperationsMixDecision): string[] {
  if (decision.source !== "ai_proposal") {
    return [];
  }

  // El monto de cada línea sale de lo impreso, y lo impreso está en la cita.
  return decision.lines.flatMap((line, index) => {
    const printed = parsePrintedAmount(line.printedAmount);

    return printed !== null &&
      printed.eq(parseDecimal(line.amount, "amount")) &&
      quoteHolds(line.quote, line.printedAmount)
      ? []
      : [`qualitativeDecisions.operationsMix.lines.${index}`];
  });
}

function mixMismatches(
  decision: OperationsMixDecision | null,
  costOfCapital: CostOfCapital,
): string[] {
  const exposure = costOfCapital.operationsExposure ?? null;

  if (decision === null || exposure === null) {
    return decision === exposure
      ? []
      : [
          "qualitativeDecisions.operationsMix",
          "costOfCapital.operationsExposure",
        ];
  }

  const lines = lineMismatches(decision);

  if (lines.length > 0) {
    return lines;
  }

  const reading = operationsMixReadingOf(decision);
  const sameExposures =
    reading.exposures.length === exposure.exposures.length &&
    reading.exposures.every((expected, index) => {
      const actual = exposure.exposures[index]!;

      return (
        expected.weight === actual.weight &&
        expected.exposureKeys.length === actual.exposureKeys.length &&
        expected.exposureKeys.every(
          (key, keyIndex) => actual.exposureKeys[keyIndex] === key,
        )
      );
    });

  return reading.source === exposure.source &&
    reading.proposalId === exposure.proposalId &&
    reading.weightsVersion === exposure.weightsVersion &&
    sameExposures
    ? []
    : ["costOfCapital.operationsExposure"];
}

/**
 * Las rutas donde el costo de capital no es lo que las decisiones dicen: otra
 * industria, otros pesos, otra propuesta, o una línea cuyo monto no sale de su
 * cita. Vacío cuando todo coincide.
 */
export function qualitativeDecisionMismatches(
  decisions: QualitativeDecisions,
  costOfCapital: CostOfCapital,
): string[] {
  return [
    ...industryMismatches(decisions.industry, costOfCapital),
    ...mixMismatches(decisions.operationsMix, costOfCapital),
  ];
}
