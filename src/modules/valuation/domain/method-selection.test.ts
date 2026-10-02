import { describe, expect, it } from "vitest";

import {
  selectValuationMethod,
  type ProfileEvidence,
} from "./method-selection";
import type { AssetProfile } from "./valuation-input";

const LEGAL_ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CUTOFF = "2025-01-01T00:00:00.000Z";
const AFTER_CUTOFF = "2025-02-01T00:00:00.000Z";
const PROFILES: AssetProfile[] = [
  "non_financial_mature",
  "high_growth",
  "bank",
  "insurer",
  "reit",
  "cyclical",
  "commodity",
  "holding",
  "distressed",
];

function evidence(
  profile: AssetProfile,
  present: boolean,
  availableAt = "2024-06-01T00:00:00.000Z",
): ProfileEvidence {
  return {
    legalEntityId: LEGAL_ENTITY_ID,
    profile,
    present,
    validFrom: "2024-01-01T00:00:00.000Z",
    validTo: null,
    availableAt,
    supersededAt: null,
    recordedAt: "2024-06-02T00:00:00.000Z",
    sourceId: "fixture-classification",
    sourceDocumentId: "synthetic-case",
    contentHash: "a".repeat(64),
  };
}

function select(
  entries: ProfileEvidence[],
  options: {
    knownAt?: string;
    fcffInputsComplete?: boolean;
    knowledgeBasis?: "public_availability" | "system_recorded";
  } = {},
) {
  return selectValuationMethod({
    legalEntityId: LEGAL_ENTITY_ID,
    knowledge: {
      effectiveAt: CUTOFF,
      knownAt: options.knownAt ?? CUTOFF,
      revisionPolicy: "as_known",
      knowledgeBasis: options.knowledgeBasis ?? "public_availability",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: "source-policy-1.0.0",
    },
    evidence: entries,
    fcffInputsComplete: options.fcffInputsComplete ?? true,
  });
}

describe("method selection 0.1.0", () => {
  it.each([
    ["bank", "excess_return", "bank_regulated"],
    ["insurer", "excess_return", "insurer_regulated"],
    ["reit", "affo_nav", "reit_structure"],
  ] as const)(
    "recognizes %s but refuses its unimplemented method",
    (profile, method, rule) => {
      const selection = select([evidence(profile, true)]);

      expect(selection).toMatchObject({
        status: "unsupported_method",
        assetProfile: profile,
        recommendedMethod: method,
        activatedRules: [rule],
        unsupportedReasons: ["method_not_implemented"],
        confidence: null,
      });
    },
  );

  it("does not infer a subtype from a broad sector with no direct evidence", () => {
    expect(select([])).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      recommendedMethod: null,
      requiredInputs: ["profile_evidence"],
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("abstains when two incompatible profiles are positively evidenced", () => {
    expect(
      select([evidence("bank", true), evidence("reit", true)]),
    ).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      activatedRules: ["bank_regulated", "reit_structure"],
      unsupportedReasons: ["conflicting_evidence"],
    });
  });

  it("admits FCFF only after every excluded profile is explicitly absent", () => {
    const complete = PROFILES.map((profile) =>
      evidence(profile, profile === "non_financial_mature"),
    );
    expect(select(complete)).toMatchObject({
      status: "selected",
      assetProfile: "non_financial_mature",
      recommendedMethod: "fcff_base",
      activatedRules: ["mature_non_financial"],
      unsupportedReasons: [],
      confidence: null,
    });

    const missing = complete.filter((item) => item.profile !== "reit");
    expect(select(missing)).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      requiredInputs: ["profile_evidence.reit"],
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("names missing structural FCFF inputs", () => {
    const complete = PROFILES.map((profile) =>
      evidence(profile, profile === "non_financial_mature"),
    );
    expect(select(complete, { fcffInputsComplete: false })).toMatchObject({
      status: "unsupported_method",
      assetProfile: "non_financial_mature",
      requiredInputs: ["fcff_inputs"],
      unsupportedReasons: ["missing_required_input"],
    });
  });

  it("does not leak evidence published after the knowledge cutoff", () => {
    const later = evidence("bank", true, AFTER_CUTOFF);

    expect(select([later]).unsupportedReasons).toEqual([
      "missing_classification_evidence",
    ]);
    expect(
      select([later], { knownAt: "2025-03-01T00:00:00.000Z" }),
    ).toMatchObject({
      assetProfile: "bank",
      unsupportedReasons: ["method_not_implemented"],
    });
  });

  it("honors the system-recorded cutoff as well as public availability", () => {
    const lateLocal = {
      ...evidence("bank", true),
      recordedAt: AFTER_CUTOFF,
    };

    expect(
      select([lateLocal], { knowledgeBasis: "system_recorded" }),
    ).toMatchObject({
      assetProfile: null,
      unsupportedReasons: ["missing_classification_evidence"],
    });
    expect(select([lateLocal])).toMatchObject({
      assetProfile: "bank",
      unsupportedReasons: ["method_not_implemented"],
    });
  });

  it("does not use evidence outside its effective interval", () => {
    const expired = {
      ...evidence("reit", true),
      validTo: "2024-12-31T00:00:00.000Z",
    };

    expect(select([expired]).unsupportedReasons).toEqual([
      "missing_classification_evidence",
    ]);
  });

  it("rejects profile evidence from another legal entity", () => {
    const mixed = {
      ...evidence("bank", true),
      legalEntityId: "22222222-2222-4222-8222-222222222222",
    };

    expect(() => select([mixed])).toThrow(
      "Profile evidence belongs to another legal entity.",
    );
  });

  it("abstains on overlapping evidence for the same profile", () => {
    expect(
      select([evidence("bank", true), evidence("bank", false)]),
    ).toMatchObject({
      status: "unsupported_method",
      unsupportedReasons: ["conflicting_evidence"],
      activatedRules: ["bank_regulated"],
    });
  });
});
