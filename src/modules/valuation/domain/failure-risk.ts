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
/**
 * `1.1.0` (`F6-41`, decisión delegada por el owner el 2026-11-19 con F
 * medido): un rating sintético `D` —la cobertura de un EBIT no positivo sin
 * caja neta que lo compense— toma la peor fila de la tabla, `CCC/C`. La tabla
 * de Damodaran no tiene fila para `D`, porque `D` es el incumplimiento mismo:
 * la probabilidad de la peor fila es una **cota inferior** del fracaso, así que
 * el valor que resulta es una cota superior, y el snapshot lo nombra
 * (`ratingStandIn`). Sólo se emite cuando hace falta: con cualquier otro rating
 * la lectura sigue siendo `1.0.0` byte a byte. Una empresa con caja neta no
 * llega acá: su cobertura es la de `net-cash-coverage-1.0.0`.
 */
export const FAILURE_RISK_DEFAULT_STAND_IN_VERSION = "failure-risk-1.1.0";
const FAILURE_RISK_VERSIONS = [
  FAILURE_RISK_VERSION,
  FAILURE_RISK_DEFAULT_STAND_IN_VERSION,
] as const;
type FailureRiskVersion = (typeof FAILURE_RISK_VERSIONS)[number];
/** La fila que reemplaza a `D` en `1.1.0`. */
const DEFAULT_STAND_IN_BUCKET = "ccc-c";
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
  version: z.enum(FAILURE_RISK_VERSIONS),
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
    /** `1.1.0`: la fila es la peor de la tabla en lugar de un `D` que no tiene. */
    ratingStandIn: z.literal("worst_row_for_default").optional(),
  }),
  z.object({
    ...base,
    basis: z.literal("owner_declaration"),
    legalEntityId: z.uuid(),
    declaration: failureProbabilityDeclarationSchema,
  }),
  z.object({
    version: z.enum(FAILURE_RISK_VERSIONS),
    basis: z.literal("missing"),
    reason: z.string().min(1).max(64),
  }),
]);
export type FailureRisk = z.infer<typeof failureRiskSchema>;

/** The seven broad S&P groups on Ginzu's sheet; no interpolation of notches. */
export function failureRatingBucket(
  rating: string,
  version: FailureRiskVersion = FAILURE_RISK_VERSION,
): string | null {
  const sp = rating.includes("/") ? rating.split("/").at(-1)! : rating;
  if (/^(?:CCC|CC|C)[+-]?$/u.test(sp)) return "ccc-c";
  if (isDefaultRating(sp))
    return version === FAILURE_RISK_DEFAULT_STAND_IN_VERSION
      ? DEFAULT_STAND_IN_BUCKET
      : null;
  const group = sp.replace(/[+-]$/u, "").toLowerCase();
  return ["aaa", "aa", "a", "bbb", "bb", "b"].includes(group) ? group : null;
}

function isDefaultRating(sp: string): boolean {
  return sp === "D";
}

function ratingGroup(rating: string): string {
  return rating.includes("/") ? rating.split("/").at(-1)! : rating;
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
    const standIn = isDefaultRating(ratingGroup(input.syntheticRating));
    const version = standIn
      ? FAILURE_RISK_DEFAULT_STAND_IN_VERSION
      : FAILURE_RISK_VERSION;
    const bucket = failureRatingBucket(input.syntheticRating, version);
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
      version,
      basis: "rating_table",
      ...(standIn ? { ratingStandIn: "worst_row_for_default" as const } : {}),
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
  const bucket = failureRatingBucket(context.syntheticRating, risk.version);
  if (risk.basis === "rating_table") {
    if (risk.parameter.rowKey !== bucket)
      errors.push("failureRisk.parameter.rowKey");
    const standIn =
      risk.version === FAILURE_RISK_DEFAULT_STAND_IN_VERSION &&
      isDefaultRating(ratingGroup(context.syntheticRating));
    if (
      (risk.ratingStandIn === "worst_row_for_default") !== standIn ||
      (risk.version === FAILURE_RISK_DEFAULT_STAND_IN_VERSION && !standIn)
    )
      errors.push("failureRisk.ratingStandIn");
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
