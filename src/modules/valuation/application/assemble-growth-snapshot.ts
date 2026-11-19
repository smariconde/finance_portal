import { selectValuationMethod } from "../domain/method-selection";
import type { ProfileEvidence } from "../domain/method-selection";
import { deriveRigorLevel } from "../domain/rigor-level";
import {
  deriveRevenueMargin,
  growthTargetMargin,
  GROWTH_FCFF_ENGINE_VERSION,
  GROWTH_METHODOLOGY_VERSION,
  REVENUE_MARGIN_VERSION,
  revenueMarginSchema,
} from "../domain/revenue-margin";
import type { DerivedGrowthTrajectory } from "../domain/derived-growth-trajectory";
import type { GrowthMarginReference } from "../domain/derived-growth-margin";
import {
  valuationInputSchema,
  type MonetaryFact,
  type ValuationInput,
} from "../domain/valuation-input";

/** Converts an assembled industrial foundation into the growth engine's input. */
export function assembleGrowthSnapshot(input: {
  readonly foundation: ValuationInput;
  readonly evidence: readonly ProfileEvidence[];
  readonly trajectory: DerivedGrowthTrajectory;
  readonly margin: GrowthMarginReference;
  readonly lossCarryforward: MonetaryFact;
  readonly lossOffsetLimit: string;
  readonly lossPolicyRationale: string;
  readonly financingRationale: string;
  readonly employeeEquityAvailableAt: string;
}): ValuationInput | null {
  const { foundation, trajectory, margin } = input;
  const evidence = input.evidence;
  const selection = selectValuationMethod({
    legalEntityId: foundation.subject.legalEntityId,
    knowledge: foundation.knowledge,
    evidence: [...evidence],
    fcffInputsComplete: true,
    growthFcffMissingInputs: [],
  });
  if (
    selection.status !== "selected" ||
    (selection.recommendedMethod !== "fcff_three_stage" &&
      selection.recommendedMethod !== "revenue_margin_survival") ||
    foundation.costOfCapital.industryKey !== margin.rowKey ||
    trajectory.revenueHistory[0]?.fiscalYearEnd !==
      foundation.baseRevenue.asOf ||
    trajectory.revenueHistory[0]?.value !== foundation.baseRevenue.value
  )
    return null;

  const target = growthTargetMargin(
    margin.value,
    foundation.baseRevenue.value,
    foundation.normalization.base.ebitAdjusted,
  );
  const plan = revenueMarginSchema.parse({
    version: REVENUE_MARGIN_VERSION,
    profileEvidence: [...evidence],
    declaredAt:
      foundation.knowledge.knownAt ?? foundation.knowledge.effectiveAt,
    highGrowthYears: trajectory.highGrowthYears,
    initialRevenueGrowth: trajectory.initialRevenueGrowth,
    revenueRationale:
      "derived-growth-trajectory-1.0.0: three-year revenue CAGR capped at 30%, three high-growth years and a linear fade to terminal growth.",
    targetMargin: target.value,
    marginConvergenceYears: trajectory.marginConvergenceYears,
    targetMarginRationale:
      target.basis === "industry"
        ? "Pretax lease- and R&D-adjusted operating margin of the dated Damodaran industry release."
        : "The company's own lease- and R&D-adjusted base-year margin, above its dated Damodaran industry margin: a proven margin is held, not converged down.",
    financingRationale: input.financingRationale,
    lossCarryforward: input.lossCarryforward,
    lossOffsetLimit: input.lossOffsetLimit,
    lossPolicyRationale: input.lossPolicyRationale,
    employeeEquityAvailableAt: input.employeeEquityAvailableAt,
    derivedFrom: { trajectory, margin },
  });
  const path = deriveRevenueMargin(
    plan,
    foundation.baseRevenue.value,
    foundation.normalization.base.ebitAdjusted,
    trajectory.explicitYears,
    foundation.terminal.growth,
  );
  if (foundation.periods.length !== trajectory.explicitYears) return null;
  const periods = foundation.periods.map((period, index) => ({
    ...period,
    revenueGrowth: path.periodGrowth[index]!,
    ebitMargin: path.periodMargins[index]!,
  }));
  const { derivedAssumptions: _prior, ...withoutPrior } = foundation;
  void _prior;
  return valuationInputSchema.parse({
    ...withoutPrior,
    assetProfile: selection.assetProfile,
    method: selection.recommendedMethod,
    engineVersion: GROWTH_FCFF_ENGINE_VERSION,
    methodologyVersion: GROWTH_METHODOLOGY_VERSION,
    assessment: {
      ...foundation.assessment,
      selection,
      // Sin opciones restadas el nivel baja uno, como en la corrida base: el
      // motor lo recalcula desde la decisión congelada (`F6-16`).
      rigor: deriveRigorLevel(selection, foundation.assessment.completeness, {
        employeeOptionsNotSubtracted:
          foundation.employeeEquity.decision.basis === "not_subtracted",
      }),
    },
    periods,
    terminal: { ...foundation.terminal, ebitMargin: target.value },
    revenueMargin: plan,
    scenarios: null,
  });
}
