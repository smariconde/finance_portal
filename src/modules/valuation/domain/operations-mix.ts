import { z } from "zod";

import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  sum,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  exposureBasisSchema,
  operationsMixAbstainReasonSchema,
  parsePrintedAmount,
} from "./operations-mix-task";

/**
 * El mix de operaciones de una empresa (`F5-05`,
 * [ADR 0034](../../../../docs/architecture/adr/0034-operations-weighted-country-risk.md),
 * decisiones 5 a 7): la propuesta de la IA persistida, la declaración del owner
 * que la pisa, y los pesos que el código calcula de cualquiera de las dos.
 *
 * Se guarda **toda** respuesta —aceptada, abstenida o frenada— con sus líneas y
 * su evidencia. Los intentos y su costo están en el libro de gasto bajo el mismo
 * `proposalId`, que es el `task_run_id` de la escalera.
 */
export const OPERATIONS_MIX_WEIGHTS_VERSION = "operations-mix-weights-1.0.0";

export const operationsMixEvidenceRecordSchema = z.object({
  evidenceId: z.string().regex(/^E[0-9]{1,2}$/u),
  sourceId: z.string().min(3).max(64),
  section: z.literal("geographic_revenue"),
  documentUrl: z.url(),
  accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
  documentAcceptedAt: z.iso.datetime({ offset: true }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteLength: z.number().int().min(1),
  truncated: z.boolean(),
  excerpt: z.string().min(1),
});

export type OperationsMixEvidenceRecord = z.infer<
  typeof operationsMixEvidenceRecordSchema
>;

export const operationsMixLineRecordSchema = z.object({
  ordinal: z.number().int().min(1).max(40),
  label: z.string().min(1).max(120),
  /** Como se imprimió; el monto exacto sale de acá, nunca del modelo. */
  printedAmount: z.string().min(1).max(32),
  amount: engineDecimalSchema,
  basis: exposureBasisSchema,
  exposureKeys: z.array(z.string().min(1).max(64)).max(12),
  quote: z.string().min(1).max(400),
  evidenceId: z.string().max(8),
  definitionQuote: z.string().min(1).max(600).nullable(),
});

export type OperationsMixLineRecord = z.infer<
  typeof operationsMixLineRecordSchema
>;

export const operationsMixOutcomeSchema = z.enum([
  "accepted",
  "abstained",
  "stopped",
]);

export const operationsMixProposalSchema = z
  .object({
    proposalId: z.uuid(),
    legalEntityId: z.uuid(),
    cik: z.string().regex(/^[0-9]{10}$/u),
    accessionNumber: z.string().regex(/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/u),
    fiscalYearEnd: z.iso.date(),
    taskVersion: z.string().min(1).max(64),
    promptVersion: z.string().min(1).max(64),
    policyVersion: z.string().min(1).max(64),
    ladderVersion: z.string().min(1).max(64),
    extractVersion: z.string().min(1).max(64),
    /** Las releases cuyas claves se ofrecieron y se validaron. */
    countryReleaseId: z.uuid(),
    regionReleaseId: z.uuid(),
    outcome: operationsMixOutcomeSchema,
    unit: z.enum(["units", "thousands", "millions", "billions"]).nullable(),
    printedTotal: z.string().min(1).max(32).nullable(),
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

    if (
      accepted !== (proposal.unit !== null && proposal.printedTotal !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["unit"],
        message: "Unit and total are recorded exactly when accepted.",
      });
    }
  });

export type OperationsMixProposal = z.infer<typeof operationsMixProposalSchema>;

export const KNOWN_MIX_ABSTAIN_REASONS = [
  ...operationsMixAbstainReasonSchema.options,
  "low_confidence",
  "ai_budget_exhausted",
  "ladder_exhausted",
] as const;

export function operationsMixDocumentId(proposalId: string): string {
  return `operations-mix/${proposalId}`;
}

/** Las líneas de una respuesta aceptada, con el monto exacto que la policy leyó. */
export function lineRecordsOf(
  lines: readonly {
    readonly label: string;
    readonly amount: string;
    readonly quote: string;
    readonly evidenceId: string;
    readonly basis: z.infer<typeof exposureBasisSchema>;
    readonly exposureKeys: readonly string[];
    readonly definitionQuote: string | null;
  }[],
): OperationsMixLineRecord[] {
  return lines.map((line, index) => {
    const amount = parsePrintedAmount(line.amount);

    if (amount === null) {
      throw new Error(`line ${index + 1} has an unreadable amount`);
    }

    return operationsMixLineRecordSchema.parse({
      ordinal: index + 1,
      label: line.label,
      printedAmount: line.amount,
      amount: formatDecimal(amount, "amount"),
      basis: line.basis,
      exposureKeys: [...line.exposureKeys],
      quote: line.quote,
      evidenceId: line.evidenceId,
      definitionQuote: line.definitionQuote,
    });
  });
}

/**
 * Lock del owner (decisión 6): por CIK, exposiciones con su peso como fracción
 * exacta que suma 1, y el motivo escrito. Con una vigente no se le pregunta al
 * modelo y ninguna propuesta se lee.
 */
export const operationsMixDeclarationSchema = z
  .object({
    cik: z.string().regex(/^[0-9]{10}$/u),
    exposures: z
      .array(
        z.object({
          exposureKeys: z.array(z.string().min(1).max(64)).min(1).max(12),
          weight: engineDecimalSchema,
        }),
      )
      .min(1)
      .max(40),
    rationale: z.string().min(20).max(2000),
    declaredOn: z.iso.date(),
  })
  .superRefine((declaration, context) => {
    const weights = declaration.exposures.map((exposure) =>
      parseDecimal(exposure.weight, "weight"),
    );

    if (weights.some((weight) => !weight.greaterThan(ZERO))) {
      context.addIssue({
        code: "custom",
        path: ["exposures"],
        message: "Every declared weight is positive.",
      });
    }

    if (!sum(weights).equals(ONE)) {
      context.addIssue({
        code: "custom",
        path: ["exposures"],
        message: "Declared weights add up to exactly 1.",
      });
    }
  });

export type OperationsMixDeclaration = z.infer<
  typeof operationsMixDeclarationSchema
>;

/** Una exposición ponderada: un lugar o un compuesto, y su parte de los ingresos. */
export type WeightedExposure = {
  readonly exposureKeys: readonly string[];
  readonly basis: z.infer<typeof exposureBasisSchema> | "owner_declaration";
  readonly weight: string;
};

/**
 * Los pesos de una propuesta aceptada: cada línea geográfica sobre la suma de
 * las geográficas. Las partidas sin lugar no pesan: no son operaciones en
 * ningún país, y la policy ya acotó su tamaño. El resto del mundo queda con las
 * claves vacías; el costo de capital lo resuelve con las nueve regiones.
 */
export function weightsOfProposal(
  lines: readonly OperationsMixLineRecord[],
): WeightedExposure[] {
  const geographic = lines.filter((line) => line.basis !== "unallocated");
  const amounts = geographic.map((line) => parseDecimal(line.amount, "amount"));
  const total = amounts.reduce((left: Dec, right) => left.plus(right), ZERO);

  if (!total.greaterThan(ZERO)) {
    throw new Error("an accepted mix has positive geographic revenue");
  }

  return geographic.map((line, index) => ({
    exposureKeys: [...line.exposureKeys],
    basis: line.basis,
    weight: formatDecimal(divide(amounts[index]!, total, "weight"), "weight"),
  }));
}

export function weightsOfDeclaration(
  declaration: OperationsMixDeclaration,
): WeightedExposure[] {
  return declaration.exposures.map((exposure) => ({
    exposureKeys: [...exposure.exposureKeys],
    basis: "owner_declaration",
    weight: exposure.weight,
  }));
}
