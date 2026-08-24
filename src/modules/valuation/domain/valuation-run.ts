import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { sourceIdSchema } from "@/modules/ingestion/domain/source-registry-entry";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  contentHashSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { decimalPolicySchema, engineDecimalSchema } from "./decimal-policy";
import { VALUATION_ERROR_CODES } from "./valuation-error";
import {
  assetProfileSchema,
  BRIDGE_ITEM_KEYS,
  claimStatusSchema,
  ENGINE_VERSION,
  METHODOLOGY_VERSION,
  VALUATION_METHOD,
  valuationInputSchema,
  valuationSubjectSchema,
  type ValuationInput,
} from "./valuation-input";

/**
 * Corrida de valuación: la forma persistida y auditable del resultado
 * (`docs/valuation/methodology.md`, sección "Output y reproducibilidad").
 *
 * Es append-only. Una corrida rechazada también se registra, porque explicar por
 * qué un valor **no** se calculó es parte del audit trail (`TM-16`). El
 * `input_hash` cubre supuestos, provenance, política numérica y versión del
 * motor: con el mismo snapshot canónico el resultado es idéntico y su replay no
 * vuelve a calcular ni consulta datos live.
 */
export const valuationRunStatusSchema = z.enum([
  "computed",
  "requires_review",
  "rejected",
]);

export type ValuationRunStatus = z.infer<typeof valuationRunStatusSchema>;

export const policyCheckSchema = z.object({
  id: z.string().trim().min(1).max(64),
  mode: z.enum(["reject", "require_review"]),
  status: z.enum(["passed", "failed"]),
  message: z.string().trim().min(1).max(240),
  subjects: z.array(z.string().trim().min(1).max(128)).max(32),
});

export const periodProjectionSchema = z.object({
  periodIndex: z.number().int().min(1).max(20),
  periodEnd: z.iso.date(),
  revenue: engineDecimalSchema,
  revenueChange: engineDecimalSchema,
  ebit: engineDecimalSchema,
  nopat: engineDecimalSchema,
  reinvestmentConvention: z.enum(["sales_to_capital", "return_on_capital"]),
  reinvestmentRate: engineDecimalSchema.nullable(),
  reinvestment: engineDecimalSchema,
  fcff: engineDecimalSchema,
  wacc: engineDecimalSchema,
  discountFactor: engineDecimalSchema,
  presentValue: engineDecimalSchema,
});

export const terminalProjectionSchema = z.object({
  growth: engineDecimalSchema,
  wacc: engineDecimalSchema,
  revenue: engineDecimalSchema,
  ebit: engineDecimalSchema,
  nopat: engineDecimalSchema,
  reinvestmentRate: engineDecimalSchema,
  fcff: engineDecimalSchema,
  terminalValue: engineDecimalSchema,
  discountFactor: engineDecimalSchema,
  presentValue: engineDecimalSchema,
});

export const bridgeComponentSchema = z.object({
  key: z.enum(BRIDGE_ITEM_KEYS),
  status: claimStatusSchema,
  sign: z.enum(["add", "subtract"]),
  value: engineDecimalSchema,
  rationale: z.string().trim().min(1).max(512).nullable(),
});

export const sensitivityCellSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("computed"),
    valuePerShare: engineDecimalSchema,
  }),
  z.object({
    status: z.literal("rejected"),
    reason: z.string().trim().min(1).max(64),
  }),
]);

const sensitivityAxisResultSchema = z.object({
  from: engineDecimalSchema,
  to: engineDecimalSchema,
  step: engineDecimalSchema,
  values: z.array(engineDecimalSchema).min(1).max(11),
});

export const sensitivityGridSchema = z.object({
  unit: z.literal("value_per_share"),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  wacc: sensitivityAxisResultSchema,
  terminalGrowth: sensitivityAxisResultSchema,
  rows: z
    .array(
      z.object({
        wacc: engineDecimalSchema,
        cells: z.array(sensitivityCellSchema).min(1).max(11),
      }),
    )
    .min(1)
    .max(11),
});

export const valuationResultSchema = z.object({
  periods: z.array(periodProjectionSchema).min(1).max(20),
  terminal: terminalProjectionSchema,
  enterpriseValue: engineDecimalSchema,
  bridgeComponents: z.array(bridgeComponentSchema).length(5),
  equityValue: engineDecimalSchema,
  dilutedShares: engineDecimalSchema,
  valuePerShare: engineDecimalSchema,
  terminalValueShare: engineDecimalSchema.nullable(),
  sensitivity: sensitivityGridSchema.nullable(),
  checks: z.array(policyCheckSchema).max(64),
});

export type ValuationResult = z.infer<typeof valuationResultSchema>;

export const valuationFailureSchema = z.object({
  code: z.enum(VALUATION_ERROR_CODES),
  message: z.string().trim().min(1).max(240),
  subjects: z.array(z.string().trim().min(1).max(128)).max(32),
});

export type ValuationFailure = z.infer<typeof valuationFailureSchema>;

/**
 * Provenance agregada del snapshot: qué fuentes y qué observaciones sostienen
 * el resultado, y bajo qué corte de conocimiento se leyeron. La superficie de
 * `F1-06` la muestra sin volver a recorrer el input.
 */
export const valuationProvenanceSchema = z.object({
  sourceIds: z.array(sourceIdSchema).max(32),
  observationIds: z.array(z.uuid()).max(64),
  knowledge: pointInTimeQuerySchema,
});

export type ValuationProvenance = z.infer<typeof valuationProvenanceSchema>;

export const valuationRunSchema = z
  .object({
    valuationRunId: z.uuid(),
    subject: valuationSubjectSchema,
    asOf: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    assetProfile: assetProfileSchema,
    method: z.literal(VALUATION_METHOD),
    engineVersion: z.literal(ENGINE_VERSION),
    methodologyVersion: z.literal(METHODOLOGY_VERSION),
    decimalPolicy: decimalPolicySchema,
    status: valuationRunStatusSchema,
    inputHash: contentHashSchema,
    resultHash: contentHashSchema.nullable(),
    input: valuationInputSchema,
    result: valuationResultSchema.nullable(),
    failure: valuationFailureSchema.nullable(),
    provenance: valuationProvenanceSchema,
    startedAt: utcTimestampSchema,
    finishedAt: utcTimestampSchema,
    recordedAt: utcTimestampSchema,
  })
  .superRefine((run, context) => {
    const rejected = run.status === "rejected";

    if (rejected !== (run.result === null)) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "A result exists exactly when the run was not rejected.",
      });
    }

    if (rejected !== (run.resultHash === null)) {
      context.addIssue({
        code: "custom",
        path: ["resultHash"],
        message: "A result hash exists exactly when the run was not rejected.",
      });
    }

    if (rejected !== (run.failure !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message:
          "A rejected run records its failure and a computed one has none.",
      });
    }

    if (Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must not precede startedAt.",
      });
    }
  });

export type ValuationRun = z.infer<typeof valuationRunSchema>;

/**
 * Hash del resultado. Incluye el `input_hash` y las versiones porque el mismo
 * output bajo otro motor es otro hecho, no el mismo resultado repetido.
 */
export function computeValuationResultHash(input: {
  inputHash: string;
  engineVersion: string;
  methodologyVersion: string;
  result: ValuationResult;
}): string {
  return computeContentHash({
    inputHash: contentHashSchema.parse(input.inputHash),
    engineVersion: input.engineVersion,
    methodologyVersion: input.methodologyVersion,
    result: valuationResultSchema.parse(input.result),
  });
}

/** Provenance derivada del snapshot: fuentes y observaciones, deduplicadas. */
export function collectValuationProvenance(
  input: ValuationInput,
): ValuationProvenance {
  const facts = [
    input.baseRevenue,
    input.dilutedShares,
    ...BRIDGE_ITEM_KEYS.map((key) => input.bridge[key].amount).filter(
      (amount) => amount !== null,
    ),
  ];

  return valuationProvenanceSchema.parse({
    sourceIds: [...new Set(facts.map((fact) => fact.sourceId))].sort(),
    observationIds: [
      ...new Set(
        facts
          .map((fact) => fact.observationId)
          .filter((observationId): observationId is string =>
            Boolean(observationId),
          ),
      ),
    ].sort(),
    knowledge: input.knowledge,
  });
}
