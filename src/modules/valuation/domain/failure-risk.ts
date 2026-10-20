import { z } from "zod";

import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";

import type { ReferenceReading } from "./cost-of-capital";
import { engineDecimalSchema, parseDecimal } from "./decimal-policy";
import { ValuationPolicyError } from "./valuation-error";

export const FAILURE_RISK_VERSION = "failure-risk-1.0.0";
export const FAILURE_RATES_DATASET = "damodaran.failure-rates";
export const FAILURE_HORIZON_YEARS = 10;

export const failureProbabilityDeclarationSchema = z.object({
  cik: z.string().regex(/^[0-9]{10}$/u),
  probability: engineDecimalSchema,
  rationale: z.string().trim().min(1).max(512),
  /** Observed owner decision: it is unavailable before this instant. */
  declaredAt: utcTimestampSchema,
});
export type FailureProbabilityDeclaration = z.infer<
  typeof failureProbabilityDeclarationSchema
>;

const base = {
  version: z.literal(FAILURE_RISK_VERSION),
  horizonYears: z.literal(FAILURE_HORIZON_YEARS),
  syntheticRating: z.string().min(1).max(32),
};
export const failureRiskSchema = z.discriminatedUnion("basis", [
  z.object({
    ...base,
    basis: z.literal("rating_table"),
    parameter: z.object({
      datasetId: z.literal(FAILURE_RATES_DATASET),
      releaseId: z.uuid(),
      rowKey: z.string().min(1).max(16),
      field: z.literal("year_10"),
      value: engineDecimalSchema,
      publishedLabel: z.string().max(64).nullable(),
      availableAt: utcTimestampSchema,
      recordedAt: utcTimestampSchema,
    }),
  }),
  z.object({
    ...base,
    basis: z.literal("owner_declaration"),
    legalEntityId: z.uuid(),
    declaration: failureProbabilityDeclarationSchema,
  }),
  z.object({
    version: z.literal(FAILURE_RISK_VERSION),
    basis: z.literal("missing"),
    reason: z.string().min(1).max(64),
  }),
]);
export type FailureRisk = z.infer<typeof failureRiskSchema>;

/** The seven broad S&P groups on Ginzu's sheet; no interpolation of notches. */
export function failureRatingBucket(rating: string): string | null {
  const sp = rating.includes("/") ? rating.split("/").at(-1)! : rating;
  if (/^(?:CCC|CC|C)[+-]?$/u.test(sp)) return "ccc-c";
  const group = sp.replace(/[+-]$/u, "").toLowerCase();
  return ["aaa", "aa", "a", "bbb", "bb", "b"].includes(group) ? group : null;
}

export function failureProbability(risk: FailureRisk): string {
  if (risk.basis === "missing")
    throw new ValuationPolicyError(
      "policy_check_failed",
      "A missing failure probability cannot be treated as zero.",
      ["failureRisk"],
    );
  const value =
    risk.basis === "rating_table"
      ? risk.parameter.value
      : risk.declaration.probability;
  const p = parseDecimal(value, "failureRisk.probability");
  if (p.lt(0) || p.gt(1))
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Failure probability must lie between zero and one.",
      ["failureRisk.probability"],
    );
  return value;
}

function visible(instant: string, query: PointInTimeQuery): boolean {
  return (
    (query.knownAt === null ||
      Date.parse(instant) <= Date.parse(query.knownAt)) &&
    Date.parse(instant) <= Date.parse(query.effectiveAt)
  );
}

export function buildFailureRisk(input: {
  syntheticRating: string | null;
  reading: ReferenceReading | null;
  knowledge: PointInTimeQuery;
  legalEntityId: string;
  cik: string | null;
  declarations: readonly FailureProbabilityDeclaration[];
}): FailureRisk {
  const missing = (reason: string): FailureRisk => ({
    version: FAILURE_RISK_VERSION,
    basis: "missing",
    reason,
  });
  if (input.syntheticRating === null)
    return missing("synthetic_rating_missing");
  const common = {
    version: FAILURE_RISK_VERSION,
    horizonYears: FAILURE_HORIZON_YEARS,
    syntheticRating: input.syntheticRating,
  } as const;
  const declaration = input.declarations
    .filter(
      (d) => d.cik === input.cik && visible(d.declaredAt, input.knowledge),
    )
    .sort((a, b) => Date.parse(b.declaredAt) - Date.parse(a.declaredAt))[0];
  if (
    declaration !== undefined &&
    input.declarations.some(
      (d) =>
        d.cik === input.cik &&
        Date.parse(d.declaredAt) === Date.parse(declaration.declaredAt) &&
        d.probability !== declaration.probability,
    )
  )
    return missing("owner_declaration_conflict");
  let risk: FailureRisk;
  if (declaration !== undefined)
    risk = {
      ...common,
      basis: "owner_declaration",
      legalEntityId: input.legalEntityId,
      declaration,
    };
  else {
    const bucket = failureRatingBucket(input.syntheticRating);
    if (bucket === null) return missing("synthetic_rating_unmapped");
    const reading = input.reading;
    if (
      reading === null ||
      reading.release.datasetId !== FAILURE_RATES_DATASET ||
      reading.release.sourceId !== "damodaran-current-data" ||
      !isEffectiveAt(reading.release, input.knowledge.effectiveAt) ||
      !isKnownAt(reading.release, input.knowledge)
    )
      return missing("failure_rate_release_missing");
    const rows = reading.rows.filter((row) => row.key === bucket);
    const value = rows[0]?.values.year_10;
    if (
      rows.length !== 1 ||
      value === null ||
      value === undefined ||
      !engineDecimalSchema.safeParse(value).success
    )
      return missing("failure_probability_missing");
    risk = {
      ...common,
      basis: "rating_table",
      parameter: {
        datasetId: FAILURE_RATES_DATASET,
        releaseId: reading.release.releaseId,
        rowKey: bucket,
        field: "year_10",
        value,
        publishedLabel: reading.release.publishedLabel,
        availableAt: reading.release.availableAt,
        recordedAt: reading.release.recordedAt,
      },
    };
  }
  try {
    failureProbability(risk);
  } catch {
    return missing("failure_probability_invalid");
  }
  return risk;
}

export function failureRiskMismatches(
  risk: FailureRisk,
  context: {
    syntheticRating: string;
    legalEntityId: string;
    knowledge: PointInTimeQuery;
  },
): string[] {
  if (risk.basis === "missing") return ["failureRisk"];
  const errors: string[] = [];
  if (risk.syntheticRating !== context.syntheticRating)
    errors.push("failureRisk.syntheticRating");
  const bucket = failureRatingBucket(context.syntheticRating);
  if (risk.basis === "rating_table") {
    if (risk.parameter.rowKey !== bucket)
      errors.push("failureRisk.parameter.rowKey");
    if (
      !visible(risk.parameter.availableAt, context.knowledge) ||
      (context.knowledge.knowledgeBasis === "system_recorded" &&
        context.knowledge.knownAt !== null &&
        Date.parse(risk.parameter.recordedAt) >
          Date.parse(context.knowledge.knownAt))
    )
      errors.push("failureRisk.parameter.availableAt");
  } else if (risk.basis === "owner_declaration") {
    if (risk.legalEntityId !== context.legalEntityId)
      errors.push("failureRisk.legalEntityId");
    if (!visible(risk.declaration.declaredAt, context.knowledge))
      errors.push("failureRisk.declaration.declaredAt");
  }
  try {
    failureProbability(risk);
  } catch {
    errors.push("failureRisk.probability");
  }
  return errors;
}
