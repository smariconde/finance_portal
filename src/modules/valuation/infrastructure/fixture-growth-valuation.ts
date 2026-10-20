import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { buildCapitalization } from "../domain/capitalization-bridge";
import { marginalTaxRateOf } from "../domain/cost-of-capital";
import { selectValuationMethod } from "../domain/method-selection";
import { buildNormalization } from "../domain/normalization";
import {
  deriveRevenueMargin,
  GROWTH_FCFF_ENGINE_VERSION,
  GROWTH_METHODOLOGY_VERSION,
  REVENUE_MARGIN_VERSION,
} from "../domain/revenue-margin";
import { deriveRigorLevel } from "../domain/rigor-level";
import {
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";
import { fixtureCycleValuation } from "./fixture-cycle-valuation";

/** Synthetic startup and growth company. Never published as an owner dataset. */
export function fixtureGrowthValuation(
  profile: "loss_making" | "high_growth" = "loss_making",
): ValuationInput {
  const input = fixtureCycleValuation();
  const evidence = input.cycleNormalization!.profileEvidence.map((item) => ({
    ...item,
    present: item.profile === profile,
    rule: "synthetic-growth-1.0.0",
    contentHash: computeContentHash({
      profile: item.profile,
      present: item.profile === profile,
    }),
  }));
  delete input.cycleNormalization;
  input.knowledge.effectiveAt = "2025-06-30T23:59:59.999Z";
  input.assetProfile = profile;
  input.method =
    profile === "high_growth" ? "fcff_three_stage" : "revenue_margin_survival";
  input.engineVersion = GROWTH_FCFF_ENGINE_VERSION;
  input.methodologyVersion = GROWTH_METHODOLOGY_VERSION;
  const capitalization = structuredClone(input.capitalization);
  capitalization.reportedEbit!.value =
    profile === "loss_making" ? "-19200000" : "9600000";
  input.capitalization = buildCapitalization(capitalization, {
    baseRevenue: input.baseRevenue.value,
    industryKey: input.costOfCapital.industryKey,
    preTaxCostOfDebt: input.costOfCapital.derived.preTaxCostOfDebt,
  });
  input.normalization = buildNormalization(input.normalization.facts, {
    baseRevenue: input.baseRevenue.value,
    capitalization: input.capitalization,
    marginalTaxRate: marginalTaxRateOf(input.costOfCapital),
  });
  input.revenueMargin = {
    version: REVENUE_MARGIN_VERSION,
    profileEvidence: evidence,
    declaredAt: "2025-06-30T12:00:00.000Z",
    highGrowthYears: 2,
    initialRevenueGrowth: "0.3",
    revenueRationale:
      "Synthetic addressable market permits two years of scale followed by a linear transition to steady state.",
    targetMargin: "0.2",
    marginConvergenceYears: 4,
    targetMarginRationale:
      "Synthetic mature competitors achieve a twenty percent operating margin.",
    financingRationale:
      "Synthetic firm can raise funds to cover negative FCFF; no issuance terms or future share count are estimated.",
    lossCarryforward: {
      ...input.baseRevenue,
      value: "10000000",
      sourceId: "fixture-growth-tax",
      sourceDocumentId: "synthetic-tax-loss-schedule",
    },
    lossOffsetLimit: "0.8",
    lossPolicyRationale:
      "Synthetic non-expiring pool with eighty percent annual EBIT offset; no credits, jurisdiction mix or ownership change.",
    employeeEquityAvailableAt: "2025-05-01T14:00:00.000Z",
  };
  const path = deriveRevenueMargin(
    input.revenueMargin,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
    input.terminal.growth,
  );
  input.periods = input.periods.map((period, index) => ({
    ...period,
    ebitMargin: path.periodMargins[index]!,
    revenueGrowth: path.periodGrowth[index]!,
  }));
  input.terminal.ebitMargin = input.revenueMargin.targetMargin;
  input.assessment.selection = selectValuationMethod({
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
    evidence,
    fcffInputsComplete: true,
    growthFcffMissingInputs: [],
  });
  input.assessment.rigor = deriveRigorLevel(
    input.assessment.selection,
    input.assessment.completeness,
  );
  return valuationInputSchema.parse(input);
}
