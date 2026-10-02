import { z } from "zod";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";

import { assetProfileSchema, type AssetProfile } from "./valuation-input";

/**
 * Selección sobre evidencia ya clasificada y fechada. Los criterios que convierten
 * fundamentals en señales de ciclo, crecimiento o distress son otro incremento.
 */
export const METHOD_SELECTION_VERSION = "method-selection-0.1.0";

export const profileEvidenceSchema = z
  .object({
    ...temporalVersionShape,
    legalEntityId: z.uuid(),
    profile: assetProfileSchema,
    present: z.boolean(),
  })
  .superRefine(refineTemporalVersion);

export type ProfileEvidence = z.infer<typeof profileEvidenceSchema>;

export const methodSelectionInputSchema = z
  .object({
    legalEntityId: z.uuid(),
    knowledge: pointInTimeQuerySchema,
    evidence: z.array(profileEvidenceSchema).max(100),
    /** Preflight estructural del snapshot FCFF, no una estimación de faltantes. */
    fcffInputsComplete: z.boolean(),
  })
  .superRefine((input, context) => {
    input.evidence.forEach((item, index) => {
      if (item.legalEntityId !== input.legalEntityId) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "legalEntityId"],
          message: "Profile evidence belongs to another legal entity.",
        });
      }
    });
  });

export type MethodSelectionInput = z.input<typeof methodSelectionInputSchema>;

export type MethodSelection = {
  version: typeof METHOD_SELECTION_VERSION;
  status: "selected" | "unsupported_method";
  assetProfile: AssetProfile | null;
  recommendedMethod: string | null;
  alternatives: string[];
  requiredInputs: string[];
  /** Sin escala calibrada: null no representa una probabilidad implícita. */
  confidence: null;
  activatedRules: string[];
  unsupportedReasons: string[];
};

const PROFILE_METHODS: Record<
  AssetProfile,
  { method: string; rule: string; requiredInputs: string[] }
> = {
  non_financial_mature: {
    method: "fcff_base",
    rule: "mature_non_financial",
    requiredInputs: ["fcff_inputs"],
  },
  high_growth: {
    method: "fcff_three_stage",
    rule: "high_growth",
    requiredInputs: ["revenue_growth", "target_margin"],
  },
  bank: {
    method: "excess_return",
    rule: "bank_regulated",
    requiredInputs: ["book_equity", "roe", "cost_of_equity"],
  },
  insurer: {
    method: "excess_return",
    rule: "insurer_regulated",
    requiredInputs: ["book_equity", "roe", "cost_of_equity"],
  },
  reit: {
    method: "affo_nav",
    rule: "reit_structure",
    requiredInputs: ["affo", "nav"],
  },
  cyclical: {
    method: "normalized_fcff",
    rule: "cyclical_exposure",
    requiredInputs: ["cycle_margins"],
  },
  commodity: {
    method: "normalized_fcff",
    rule: "commodity_exposure",
    requiredInputs: ["normalized_price"],
  },
  holding: {
    method: "sotp_nav",
    rule: "holding_structure",
    requiredInputs: ["segment_values"],
  },
  distressed: {
    method: "apv_scenarios",
    rule: "distress",
    requiredInputs: ["failure_scenarios"],
  },
};

const PROFILE_ORDER = assetProfileSchema.options;

function result(
  assetProfile: AssetProfile | null,
  reason: string | null,
  requiredInputs: string[],
  activatedRules: string[],
): MethodSelection {
  const descriptor =
    assetProfile === null ? null : PROFILE_METHODS[assetProfile];

  return {
    version: METHOD_SELECTION_VERSION,
    status: reason === null ? "selected" : "unsupported_method",
    assetProfile,
    recommendedMethod: descriptor?.method ?? null,
    alternatives: [],
    requiredInputs,
    confidence: null,
    activatedRules,
    unsupportedReasons: reason === null ? [] : [reason],
  };
}

export function selectValuationMethod(
  candidate: MethodSelectionInput,
): MethodSelection {
  const input = methodSelectionInputSchema.parse(candidate);
  const visible = input.evidence.filter(
    (item) =>
      isEffectiveAt(item, input.knowledge.effectiveAt) &&
      isKnownAt(item, input.knowledge),
  );

  const byProfile = PROFILE_ORDER.map((profile) => ({
    profile,
    matches: visible.filter((item) => item.profile === profile),
  }));
  const conflicting = byProfile.filter((entry) => entry.matches.length > 1);
  const positive = byProfile.filter((entry) =>
    entry.matches.some((item) => item.present),
  );

  if (conflicting.length > 0 || positive.length > 1) {
    const rules = positive.map((entry) => PROFILE_METHODS[entry.profile].rule);
    return result(null, "conflicting_evidence", [], rules);
  }

  const selected = positive[0]?.profile;
  if (selected === undefined) {
    return result(
      null,
      "missing_classification_evidence",
      ["profile_evidence"],
      [],
    );
  }

  const descriptor = PROFILE_METHODS[selected];
  if (selected !== "non_financial_mature") {
    return result(
      selected,
      "method_not_implemented",
      descriptor.requiredInputs,
      [descriptor.rule],
    );
  }

  const missingExclusions = byProfile
    .filter(
      (entry) =>
        entry.profile !== selected &&
        (entry.matches.length !== 1 || entry.matches[0]!.present),
    )
    .map((entry) => "profile_evidence." + entry.profile);

  if (missingExclusions.length > 0) {
    return result(null, "missing_classification_evidence", missingExclusions, [
      descriptor.rule,
    ]);
  }

  if (!input.fcffInputsComplete) {
    return result(
      selected,
      "missing_required_input",
      descriptor.requiredInputs,
      [descriptor.rule],
    );
  }

  return result(selected, null, [], [descriptor.rule]);
}
