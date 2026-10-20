import { z } from "zod";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";
import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";
import {
  profileEvidenceSchema,
  selectValuationMethod,
} from "./method-selection";
import { monetaryFactSchema } from "./valuation-facts";
import { ValuationPolicyError } from "./valuation-error";
import type { ValuationInput } from "./valuation-input";

export const GROWTH_FCFF_ENGINE_VERSION = "growth-fcff-1.0.0";
export const GROWTH_METHODOLOGY_VERSION = "growth-fcff-1.0.0";
export const REVENUE_MARGIN_VERSION = "revenue-margin-1.0.0";
const rationale = z.string().trim().min(1).max(512);
export const revenueMarginSchema = z.object({
  version: z.literal(REVENUE_MARGIN_VERSION),
  profileEvidence: z.array(profileEvidenceSchema).min(1).max(100),
  declaredAt: utcTimestampSchema,
  highGrowthYears: z.number().int().min(1).max(19),
  initialRevenueGrowth: engineDecimalSchema,
  revenueRationale: rationale,
  targetMargin: engineDecimalSchema,
  marginConvergenceYears: z.number().int().min(1).max(20),
  targetMarginRationale: rationale,
  financingRationale: rationale,
  lossCarryforward: monetaryFactSchema.nullable(),
  lossOffsetLimit: engineDecimalSchema,
  lossPolicyRationale: rationale,
  employeeEquityAvailableAt: utcTimestampSchema,
});
export type RevenueMargin = z.infer<typeof revenueMarginSchema>;

/** High growth, linear transition and steady state. No earnings CAGR on losses. */
export function deriveRevenueMargin(
  plan: RevenueMargin,
  baseRevenue: string,
  baseEbit: string | null,
  periodCount: number,
  terminalGrowth: string,
) {
  if (
    baseEbit === null ||
    !parseDecimal(baseRevenue, "baseRevenue").gt(ZERO) ||
    plan.highGrowthYears >= periodCount ||
    plan.marginConvergenceYears > periodCount
  )
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Revenue-to-margin needs positive sales, operating income and separate growth and transition horizons.",
      ["revenueMargin", "baseRevenue"],
    );
  const current = divide(
    parseDecimal(baseEbit, "baseEbit"),
    parseDecimal(baseRevenue, "baseRevenue"),
    "baseRevenue",
  );
  const target = parseDecimal(plan.targetMargin, "targetMargin");
  const initial = parseDecimal(
    plan.initialRevenueGrowth,
    "initialRevenueGrowth",
  );
  const stable = parseDecimal(terminalGrowth, "terminalGrowth");
  return {
    currentMargin: formatDecimal(current, "currentMargin"),
    targetMargin: plan.targetMargin,
    periodMargins: Array.from({ length: periodCount }, (_, i) =>
      formatDecimal(
        i + 1 >= plan.marginConvergenceYears
          ? target
          : current.plus(
              target
                .minus(current)
                .times(
                  divide(
                    parseDecimal(String(i + 1), "year"),
                    parseDecimal(String(plan.marginConvergenceYears), "years"),
                    "years",
                  ),
                ),
            ),
        "margin",
      ),
    ),
    periodGrowth: Array.from({ length: periodCount }, (_, i) =>
      formatDecimal(
        i < plan.highGrowthYears
          ? initial
          : initial.plus(
              stable
                .minus(initial)
                .times(
                  divide(
                    parseDecimal(String(i + 1 - plan.highGrowthYears), "year"),
                    parseDecimal(
                      String(periodCount - plan.highGrowthYears),
                      "years",
                    ),
                    "years",
                  ),
                ),
            ),
        "growth",
      ),
    ),
  };
}

/** An explicit simplified tax pool, never an immediate refund on operating losses. */
export function computeLossTax(
  ebit: Dec,
  openingLoss: Dec,
  taxRate: Dec,
  offsetLimit: Dec,
) {
  const used = ebit.gt(ZERO)
    ? openingLoss.lte(ebit.times(offsetLimit))
      ? openingLoss
      : ebit.times(offsetLimit)
    : ZERO;
  const taxable = ebit.gt(ZERO) ? ebit.minus(used) : ZERO;
  const closing = ebit.lt(ZERO)
    ? openingLoss.minus(ebit)
    : openingLoss.minus(used);
  const taxes = taxable.times(taxRate);
  return {
    nopat: ebit.minus(taxes),
    closing,
    trace: {
      opening: formatDecimal(openingLoss, "openingLoss"),
      used: formatDecimal(used, "lossUsed"),
      closing: formatDecimal(closing, "closingLoss"),
      taxableIncome: formatDecimal(taxable, "taxableIncome"),
      taxes: formatDecimal(taxes, "taxes"),
    },
  };
}

export function revenueMarginMismatches(input: ValuationInput): string[] {
  const plan = input.revenueMargin;
  if (plan === undefined) return ["revenueMargin"];
  const paths: string[] = [];
  if (input.cycleNormalization !== undefined) paths.push("cycleNormalization");
  if (input.knowledge.knowledgeBasis !== "public_availability")
    paths.push("knowledge.knowledgeBasis");
  if (input.knowledge.effectiveAt.slice(0, 10) !== input.asOf)
    paths.push("knowledge.effectiveAt");
  const cutoff = Math.min(
    Date.parse(input.knowledge.knownAt ?? `${input.asOf}T23:59:59.999Z`),
    Date.parse(input.knowledge.effectiveAt),
  );
  for (const key of ["declaredAt", "employeeEquityAvailableAt"] as const)
    if (Date.parse(plan[key]) > cutoff) paths.push(`revenueMargin.${key}`);
  const loss = plan.lossCarryforward;
  if (
    loss === null ||
    loss.currency !== input.currency ||
    loss.asOf !== input.baseRevenue.asOf ||
    Date.parse(loss.availableAt) > cutoff ||
    loss.sourceDocumentId === null ||
    parseDecimal(loss.value, "lossCarryforward").lt(ZERO)
  )
    paths.push("revenueMargin.lossCarryforward");
  const offset = parseDecimal(plan.lossOffsetLimit, "lossOffsetLimit");
  if (offset.lt(0) || offset.gt(1)) paths.push("revenueMargin.lossOffsetLimit");
  if (
    plan.profileEvidence.some(
      (item) => item.legalEntityId !== input.subject.legalEntityId,
    )
  )
    paths.push("revenueMargin.profileEvidence");
  else {
    const selection = selectValuationMethod({
      legalEntityId: input.subject.legalEntityId,
      knowledge: input.knowledge,
      evidence: plan.profileEvidence,
      fcffInputsComplete: true,
      growthFcffMissingInputs: [],
    });
    if (
      selection.status !== "selected" ||
      selection.assetProfile !== input.assetProfile ||
      selection.recommendedMethod !== input.method ||
      computeContentHash(selection) !==
        computeContentHash(input.assessment.selection)
    )
      paths.push("assessment.selection");
  }
  const derived = deriveRevenueMargin(
    plan,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
    input.terminal.growth,
  );
  if (
    !parseDecimal(plan.targetMargin, "targetMargin").gt(0) ||
    parseDecimal(plan.targetMargin, "targetMargin").gt(1)
  )
    paths.push("revenueMargin.targetMargin");
  if (
    parseDecimal(plan.initialRevenueGrowth, "growth").lt(
      parseDecimal(input.terminal.growth, "terminalGrowth"),
    ) ||
    parseDecimal(input.terminal.growth, "growth").lt(0)
  )
    paths.push("revenueMargin.initialRevenueGrowth");
  if (
    input.assetProfile === "loss_making" &&
    !parseDecimal(input.normalization.base.ebitAdjusted!, "baseEbit").lt(0)
  )
    paths.push("normalization.base.ebitAdjusted");
  input.periods.forEach((period, i) => {
    if (
      !parseDecimal(period.ebitMargin, "margin").eq(
        parseDecimal(derived.periodMargins[i]!, "margin"),
      )
    )
      paths.push(`periods.${i}.ebitMargin`);
    if (
      !parseDecimal(period.revenueGrowth, "growth").eq(
        parseDecimal(derived.periodGrowth[i]!, "growth"),
      )
    )
      paths.push(`periods.${i}.revenueGrowth`);
    if (period.reinvestment.convention !== "sales_to_capital")
      paths.push(`periods.${i}.reinvestment`);
    if (
      parseDecimal(period.taxRate, "taxRate").lt(0) ||
      parseDecimal(period.taxRate, "taxRate").gt(1)
    )
      paths.push(`periods.${i}.taxRate`);
    const previous =
      i === 0 ? input.baseRevenue.asOf : input.periods[i - 1]!.periodEnd;
    const days =
      (Date.parse(period.periodEnd) - Date.parse(previous)) / 86400000;
    if (days < 350 || days > 380) paths.push(`periods.${i}.periodEnd`);
  });
  if (
    !parseDecimal(input.terminal.ebitMargin, "margin").eq(
      parseDecimal(plan.targetMargin, "margin"),
    )
  )
    paths.push("terminal.ebitMargin");
  if (
    parseDecimal(input.terminal.taxRate, "taxRate").lt(0) ||
    parseDecimal(input.terminal.taxRate, "taxRate").gt(1)
  )
    paths.push("terminal.taxRate");
  return paths.slice(0, 32);
}
