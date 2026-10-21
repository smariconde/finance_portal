import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  contentHashSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import { reitComputationSchema } from "./reit";
import { reitInputSchema } from "./reit-input";
import { engineDecimalSchema } from "./decimal-policy";
import {
  policyCheckSchema,
  valuationFailureSchema,
  valuationRunStatusSchema,
  valuationProvenanceSchema,
} from "./valuation-run";

export const reitResultSchema = z.object({
  base: reitComputationSchema,
  scenarios: z
    .object({
      bear: reitComputationSchema,
      bull: reitComputationSchema,
    })
    .nullable(),
  navSensitivity: z
    .array(
      z.object({
        capRate: engineDecimalSchema,
        status: z.enum(["computed", "rejected"]),
        valuePerShare: engineDecimalSchema.nullable(),
        reasons: z.array(z.string().min(1)).max(4),
      }),
    )
    .max(11)
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
export const reitRunSchema = z
  .object({
    valuationRunId: z.uuid(),
    method: z.literal("affo_nav"),
    subject: reitInputSchema.shape.subject,
    asOf: reitInputSchema.shape.asOf,
    currency: reitInputSchema.shape.currency,
    assetProfile: reitInputSchema.shape.assetProfile,
    engineVersion: reitInputSchema.shape.engineVersion,
    methodologyVersion: reitInputSchema.shape.methodologyVersion,
    decimalPolicy: reitInputSchema.shape.decimalPolicy,
    provenance: valuationProvenanceSchema,
    input: reitInputSchema,
    inputHash: contentHashSchema,
    resultHash: contentHashSchema.nullable(),
    status: valuationRunStatusSchema,
    result: reitResultSchema.nullable(),
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

export type ReitRun = z.infer<typeof reitRunSchema>;

export function computeReitResultHash(
  inputHash: string,
  result: z.infer<typeof reitResultSchema>,
): string {
  return computeContentHash({
    inputHash: contentHashSchema.parse(inputHash),
    result: reitResultSchema.parse(result),
  });
}
