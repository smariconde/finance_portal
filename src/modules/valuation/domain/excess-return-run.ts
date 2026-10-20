import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  contentHashSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { excessReturnComputationSchema } from "./excess-return";
import { excessReturnInputSchema } from "./excess-return-input";
import { engineDecimalSchema } from "./decimal-policy";
import {
  policyCheckSchema,
  valuationFailureSchema,
  valuationRunStatusSchema,
  valuationProvenanceSchema,
} from "./valuation-run";

export const excessReturnResultSchema = z.object({
  base: excessReturnComputationSchema,
  scenarios: z
    .object({
      bear: excessReturnComputationSchema,
      bull: excessReturnComputationSchema,
    })
    .nullable(),
  checks: z.array(policyCheckSchema).max(64),
  modelStatus: z.literal("experimental"),
  rigor: z.literal("screening"),
  sensitivity: z
    .object({
      unit: z.literal("value_per_share"),
      currency: z.string().regex(/^[A-Z]{3}$/u),
      terminalGrowthRates: z.array(engineDecimalSchema).min(1).max(11),
      rows: z
        .array(
          z.object({
            terminalEquityBeta: engineDecimalSchema,
            terminalCostOfEquity: engineDecimalSchema,
            cells: z
              .array(
                z.discriminatedUnion("status", [
                  z.object({
                    status: z.literal("computed"),
                    valuePerShare: engineDecimalSchema,
                  }),
                  z.object({
                    status: z.literal("rejected"),
                    reasons: z.array(z.string().min(1)).min(1).max(3),
                  }),
                ]),
              )
              .min(1)
              .max(11),
          }),
        )
        .min(1)
        .max(11),
    })
    .nullable(),
});

/** Immutable run, including refusals; hashes exclude clocks and generated IDs. */
export const excessReturnRunSchema = z
  .object({
    valuationRunId: z.uuid(),
    method: z.literal("excess_return"),
    subject: excessReturnInputSchema.shape.subject,
    asOf: excessReturnInputSchema.shape.asOf,
    currency: excessReturnInputSchema.shape.currency,
    assetProfile: excessReturnInputSchema.shape.assetProfile,
    engineVersion: excessReturnInputSchema.shape.engineVersion,
    methodologyVersion: excessReturnInputSchema.shape.methodologyVersion,
    decimalPolicy: excessReturnInputSchema.shape.decimalPolicy,
    provenance: valuationProvenanceSchema,
    input: excessReturnInputSchema,
    inputHash: contentHashSchema,
    resultHash: contentHashSchema.nullable(),
    status: valuationRunStatusSchema,
    result: excessReturnResultSchema.nullable(),
    failure: valuationFailureSchema
      .extend({ subjects: z.array(z.string().min(1).max(128)).max(128) })
      .nullable(),
    startedAt: utcTimestampSchema,
    finishedAt: utcTimestampSchema,
    recordedAt: utcTimestampSchema,
  })
  .superRefine((run, context) => {
    const rejected = run.status === "rejected";
    for (const key of [
      "subject",
      "asOf",
      "currency",
      "assetProfile",
      "engineVersion",
      "methodologyVersion",
      "decimalPolicy",
    ] as const) {
      if (computeContentHash(run[key]) !== computeContentHash(run.input[key]))
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Run metadata must match the input snapshot.",
        });
    }
    if (
      rejected !== (run.result === null) ||
      rejected !== (run.resultHash === null) ||
      rejected !== (run.failure !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A refusal has a failure; an admitted run has a result and hash.",
      });
    }
    if (
      Date.parse(run.finishedAt) < Date.parse(run.startedAt) ||
      Date.parse(run.recordedAt) < Date.parse(run.finishedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Run timestamps must be ordered.",
      });
    }
  });

export type ExcessReturnRun = z.infer<typeof excessReturnRunSchema>;

export function computeExcessReturnResultHash(
  inputHash: string,
  result: z.infer<typeof excessReturnResultSchema>,
): string {
  return computeContentHash({
    inputHash: contentHashSchema.parse(inputHash),
    result: excessReturnResultSchema.parse(result),
  });
}
