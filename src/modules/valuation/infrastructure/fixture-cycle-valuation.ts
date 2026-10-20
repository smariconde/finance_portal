import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import {
  CYCLE_METHODOLOGY_VERSION,
  CYCLE_NORMALIZATION_VERSION,
  deriveCycleNormalization,
  NORMALIZED_FCFF_ENGINE_VERSION,
} from "../domain/cycle-normalization";
import {
  PROFILE_PRECEDENCE,
  selectValuationMethod,
} from "../domain/method-selection";
import { deriveRigorLevel } from "../domain/rigor-level";
import {
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";
import { DEMO_VALUATION_INPUT } from "./demo-valuation-fixtures";

/** Synthetic cycle, never a default dataset or a claim about a real issuer. */
export function fixtureCycleValuation(
  profile: "cyclical" | "commodity" = "cyclical",
): ValuationInput {
  const input = structuredClone(DEMO_VALUATION_INPUT);
  input.method = "normalized_fcff";
  input.engineVersion = NORMALIZED_FCFF_ENGINE_VERSION;
  input.methodologyVersion = CYCLE_METHODOLOGY_VERSION;
  input.assetProfile = profile;
  input.scenarios = null;
  // The older FCFF fixture intentionally predates these synthetic witnesses.
  // This archetype freezes internally consistent public availability instead.
  input.knowledge = {
    ...input.knowledge,
    revisionPolicy: "as_known",
    knowledgeBasis: "public_availability",
    knownAt: "2025-06-30T23:59:59.999Z",
  };
  input.employeeEquity.sharesOutstanding.availableAt =
    "2025-06-30T12:00:00.000Z";
  input.costOfCapital.parameters.forEach((parameter) => {
    parameter.availableAt = "2025-05-01T14:00:00.000Z";
    parameter.publishedLabel = "synthetic-cycle-reference";
  });
  const profileEvidence = PROFILE_PRECEDENCE.flat().map((item) => ({
    legalEntityId: input.subject.legalEntityId,
    profile: item,
    present: item === profile,
    rule: "synthetic-cycle-1.0.0",
    derivation: "primary" as const,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
    availableAt: "2025-05-01T14:00:00.000Z",
    recordedAt: "2025-05-01T14:00:00.000Z",
    supersededAt: null,
    sourceId: "fixture-cycle",
    sourceDocumentId: "synthetic-cycle-thesis",
    contentHash: computeContentHash({
      profile: item,
      present: item === profile,
    }),
  }));
  input.cycleNormalization = {
    version: CYCLE_NORMALIZATION_VERSION,
    profileEvidence,
    cycleRationale:
      "Synthetic five-year cycle includes a loss, recovery and peak; no operating perimeter changes.",
    accountingBasis:
      "EBIT on the same adjusted operating basis in each year; no R&D or leases in this synthetic case.",
    inflationBasis: "same_year_nominal_ratios",
    convergenceYears: 3,
    employeeEquityAvailableAt: "2025-05-01T14:00:00.000Z",
    marginShift: null,
    history: [
      ["2020-12-31", "24000000", "2400000"],
      ["2021-12-31", "48000000", "9600000"],
      ["2022-12-31", "96000000", "-9600000"],
      ["2023-12-31", "72000000", "10800000"],
      [
        "2024-12-31",
        input.baseRevenue.value,
        input.normalization.base.ebitAdjusted!,
      ],
    ].map(([date, revenue, ebit]) => ({
      fiscalYearEnd: date!,
      revenue: {
        ...input.baseRevenue,
        value: revenue!,
        asOf: date!,
        sourceId: "fixture-cycle",
        sourceDocumentId: `synthetic-cycle-${date}`,
      },
      ebit: {
        ...input.baseRevenue,
        value: ebit!,
        asOf: date!,
        sourceId: "fixture-cycle",
        sourceDocumentId: `synthetic-cycle-${date}`,
      },
    })),
  };
  const cycle = deriveCycleNormalization(
    input.cycleNormalization,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
  );
  input.periods = input.periods.map((period, index) => ({
    ...period,
    ebitMargin: cycle.periodMargins[index]!,
  }));
  input.terminal.ebitMargin = cycle.targetMargin;
  input.assessment.selection = selectValuationMethod({
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
    evidence: profileEvidence,
    fcffInputsComplete: true,
    normalizedFcffMissingInputs: [],
  });
  input.assessment.rigor = deriveRigorLevel(
    input.assessment.selection,
    input.assessment.completeness,
  );
  return valuationInputSchema.parse(input);
}
