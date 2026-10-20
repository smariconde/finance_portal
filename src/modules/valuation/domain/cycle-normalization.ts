import { z } from "zod";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  calendarDateSchema,
  utcTimestampSchema,
} from "@/modules/temporal/domain/temporal-version";
import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  sum,
  ZERO,
} from "./decimal-policy";
import {
  profileEvidenceSchema,
  selectValuationMethod,
} from "./method-selection";
import { monetaryFactSchema } from "./valuation-facts";
import { ValuationPolicyError } from "./valuation-error";
import type { ValuationInput } from "./valuation-input";

export const NORMALIZED_FCFF_ENGINE_VERSION = "normalized-fcff-1.0.0";
export const CYCLE_METHODOLOGY_VERSION = "cycle-fcff-1.0.0";
export const CYCLE_NORMALIZATION_VERSION = "cycle-normalization-1.0.0";
const rationale = z.string().trim().min(1).max(512);

/** Private owner snapshot; never expands the SEC ingestion/history window. */
export const cycleNormalizationSchema = z.object({
  version: z.literal(CYCLE_NORMALIZATION_VERSION),
  profileEvidence: z.array(profileEvidenceSchema).min(1).max(100),
  cycleRationale: rationale,
  accountingBasis: rationale,
  inflationBasis: z.literal("same_year_nominal_ratios"),
  history: z
    .array(
      z.object({
        fiscalYearEnd: calendarDateSchema,
        revenue: monetaryFactSchema.nullable(),
        ebit: monetaryFactSchema.nullable(),
      }),
    )
    .max(10),
  convergenceYears: z.number().int().min(1).max(20),
  employeeEquityAvailableAt: utcTimestampSchema,
  /** Explicit stress of the historical margin, also used by bear/bull. */
  marginShift: z.object({ value: engineDecimalSchema, rationale }).nullable(),
});
export type CycleNormalization = z.infer<typeof cycleNormalizationSchema>;

export type CycleNormalizationResult = {
  annualMargins: string[];
  historicalMargin: string;
  targetMargin: string;
  currentMargin: string;
  normalizedBaseEbit: string;
  periodMargins: string[];
};

export function deriveCycleNormalization(
  cycle: CycleNormalization,
  baseRevenue: string,
  currentEbit: string | null,
  periodCount: number,
): CycleNormalizationResult {
  if (
    cycle.history.length < 5 ||
    currentEbit === null ||
    cycle.convergenceYears > periodCount
  )
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Cycle normalization needs five to ten complete years and an explicit convergence horizon.",
      ["cycleNormalization.history", "cycleNormalization.convergenceYears"],
    );
  const annualMargins = cycle.history.map((year, index) => {
    if (
      year.revenue === null ||
      year.ebit === null ||
      !parseDecimal(year.revenue.value, "revenue").gt(ZERO)
    )
      throw new ValuationPolicyError(
        "policy_check_failed",
        "A cycle year needs positive sales and reported operating income; missing is not zero.",
        [`cycleNormalization.history.${index}`],
      );
    return formatDecimal(
      divide(
        parseDecimal(year.ebit.value, "ebit"),
        parseDecimal(year.revenue.value, "revenue"),
        "revenue",
      ),
      "margin",
    );
  });
  const historical = divide(
    sum(annualMargins.map((value) => parseDecimal(value, "margin"))),
    parseDecimal(String(annualMargins.length), "years"),
    "years",
  );
  const target = historical.plus(
    parseDecimal(
      cycle.marginShift?.value ?? "0",
      "cycleNormalization.marginShift",
    ),
  );
  const revenue = parseDecimal(baseRevenue, "baseRevenue");
  if (!revenue.gt(ZERO))
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Cycle normalization needs positive current revenue.",
      ["baseRevenue"],
    );
  const current = divide(
    parseDecimal(currentEbit, "ebit"),
    revenue,
    "baseRevenue",
  );
  return {
    annualMargins,
    historicalMargin: formatDecimal(historical, "historicalMargin"),
    targetMargin: formatDecimal(target, "targetMargin"),
    currentMargin: formatDecimal(current, "currentMargin"),
    normalizedBaseEbit: formatDecimal(
      revenue.times(historical),
      "normalizedBaseEbit",
    ),
    periodMargins: Array.from({ length: periodCount }, (_, index) => {
      if (index + 1 >= cycle.convergenceYears)
        return formatDecimal(target, "margin");
      const weight = divide(
        parseDecimal(String(index + 1), "year"),
        parseDecimal(String(cycle.convergenceYears), "years"),
        "years",
      );
      return formatDecimal(
        current.plus(target.minus(current).times(weight)),
        "margin",
      );
    }),
  };
}

export function cycleNormalizationMismatches(input: ValuationInput): string[] {
  const cycle = input.cycleNormalization;
  if (cycle === undefined) return ["cycleNormalization"];
  const mismatches: string[] = [];
  // Facts have public availability, but no recordedAt: system-recorded cannot be proved.
  if (input.knowledge.knowledgeBasis !== "public_availability")
    mismatches.push("knowledge.knowledgeBasis");
  if (input.knowledge.effectiveAt.slice(0, 10) !== input.asOf)
    mismatches.push("knowledge.effectiveAt");
  const cutoff = input.knowledge.knownAt ?? `${input.asOf}T23:59:59.999Z`;
  if (Date.parse(cycle.employeeEquityAvailableAt) > Date.parse(cutoff))
    mismatches.push("cycleNormalization.employeeEquityAvailableAt");
  const facts = [
    input.baseRevenue,
    ...cycle.history.flatMap((year) => [year.revenue, year.ebit]),
  ];
  facts.forEach((fact, index) => {
    if (
      fact !== null &&
      (fact.currency !== input.currency ||
        fact.asOf > input.baseRevenue.asOf ||
        Date.parse(fact.availableAt) > Date.parse(cutoff) ||
        Date.parse(fact.availableAt) >
          Date.parse(`${input.asOf}T23:59:59.999Z`) ||
        fact.sourceDocumentId === null)
    )
      mismatches.push(`cycleNormalization.facts.${index}`);
  });
  cycle.history.forEach((year, index) => {
    const previous = cycle.history[index - 1];
    const gap =
      previous === undefined
        ? null
        : (Date.parse(year.fiscalYearEnd) -
            Date.parse(previous.fiscalYearEnd)) /
          86400000;
    if (
      (gap !== null && (gap < 350 || gap > 380)) ||
      year.revenue?.asOf !== year.fiscalYearEnd ||
      year.ebit?.asOf !== year.fiscalYearEnd
    )
      mismatches.push(`cycleNormalization.history.${index}`);
  });
  const latest = cycle.history.at(-1);
  if (
    latest?.fiscalYearEnd !== input.baseRevenue.asOf ||
    latest.revenue === null ||
    latest.revenue === undefined ||
    latest.ebit === null ||
    latest.ebit === undefined ||
    input.normalization.base.ebitAdjusted === null ||
    !parseDecimal(latest.revenue.value, "cycle.revenue").eq(
      parseDecimal(input.baseRevenue.value, "baseRevenue"),
    ) ||
    !parseDecimal(latest.ebit.value, "cycle.ebit").eq(
      parseDecimal(input.normalization.base.ebitAdjusted, "normalization.ebit"),
    )
  )
    mismatches.push("cycleNormalization.history.latest");
  if (
    cycle.profileEvidence.some(
      (item) => item.legalEntityId !== input.subject.legalEntityId,
    )
  )
    return [...mismatches, "cycleNormalization.profileEvidence"];
  const selection = selectValuationMethod({
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
    evidence: cycle.profileEvidence,
    fcffInputsComplete: true,
    normalizedFcffMissingInputs: [],
  });
  if (
    selection.status !== "selected" ||
    selection.assetProfile !== input.assetProfile ||
    selection.recommendedMethod !== "normalized_fcff" ||
    computeContentHash(selection) !==
      computeContentHash(input.assessment.selection)
  )
    mismatches.push("assessment.selection");
  const derived = deriveCycleNormalization(
    cycle,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
  );
  if (
    !parseDecimal(derived.historicalMargin, "margin").gt(ZERO) ||
    !parseDecimal(derived.targetMargin, "margin").gt(ZERO)
  )
    mismatches.push("cycleNormalization.targetMargin");
  input.periods.forEach((period, index) => {
    if (
      !parseDecimal(period.ebitMargin, "margin").eq(
        parseDecimal(derived.periodMargins[index]!, "margin"),
      )
    )
      mismatches.push(`periods.${index}.ebitMargin`);
    // A margin recovery is not growth: sales-to-capital avoids growth/ROIC on negative NOPAT.
    if (period.reinvestment.convention !== "sales_to_capital")
      mismatches.push(`periods.${index}.reinvestment`);
  });
  if (
    !parseDecimal(input.terminal.ebitMargin, "margin").eq(
      parseDecimal(derived.targetMargin, "margin"),
    )
  )
    mismatches.push("terminal.ebitMargin");
  return mismatches.slice(0, 32);
}
