import { describe, expect, it } from "vitest";

import {
  PROFILE_PRECEDENCE,
  selectValuationMethod,
  type ProfileEvidence,
  type SignalProfile,
} from "./method-selection";

const LEGAL_ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const CUTOFF = "2025-01-01T00:00:00.000Z";
const AFTER_CUTOFF = "2025-02-01T00:00:00.000Z";
const SIGNALS: SignalProfile[] = PROFILE_PRECEDENCE.flat();

function evidence(
  profile: SignalProfile,
  present: boolean,
  availableAt = "2024-06-01T00:00:00.000Z",
  derivation: ProfileEvidence["derivation"] = "primary",
): ProfileEvidence {
  return {
    legalEntityId: LEGAL_ENTITY_ID,
    profile,
    present,
    rule: "fixture-rule-1.0.0",
    derivation,
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

/** Todos los perfiles con evidencia: los nombrados positivos, el resto negativos. */
function allDecided(...present: SignalProfile[]): ProfileEvidence[] {
  return SIGNALS.map((profile) => evidence(profile, present.includes(profile)));
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

describe("method selection 0.2.0", () => {
  it.each([
    ["bank", "excess_return", "bank_regulated"],
    ["insurer", "excess_return", "insurer_regulated"],
    ["reit", "affo_nav", "reit_structure"],
  ] as const)(
    "recognizes %s from the first tier alone but refuses its unimplemented method",
    (profile, method, rule) => {
      const selection = select([evidence(profile, true)]);

      expect(selection).toMatchObject({
        version: "method-selection-0.2.0",
        status: "unsupported_method",
        assetProfile: profile,
        recommendedMethod: method,
        activatedRules: [rule],
        unsupportedReasons: ["method_not_implemented"],
        confidence: "high",
      });
    },
  );

  it("names every undecided profile instead of assuming one from a broad sector", () => {
    expect(select([])).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      recommendedMethod: null,
      requiredInputs: SIGNALS.map((profile) => "profile_evidence." + profile),
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("abstains when two first-tier profiles are both evidenced", () => {
    expect(
      select([evidence("bank", true), evidence("reit", true)]),
    ).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      activatedRules: ["bank_regulated", "reit_structure"],
      unsupportedReasons: ["conflicting_evidence"],
    });
  });

  it("lets a higher-precedence signal win and keeps the yielded one as an alternative", () => {
    expect(select(allDecided("cyclical", "high_growth"))).toMatchObject({
      assetProfile: "cyclical",
      recommendedMethod: "normalized_fcff",
      alternatives: ["fcff_three_stage"],
      activatedRules: ["cyclical_exposure", "high_growth"],
      unsupportedReasons: ["method_not_implemented"],
    });
  });

  it("does not repeat the recommended method as its own alternative", () => {
    expect(select(allDecided("commodity", "cyclical"))).toMatchObject({
      assetProfile: "commodity",
      alternatives: [],
      activatedRules: ["commodity_exposure", "cyclical_exposure"],
    });
  });

  it("refuses a lower signal while a profile that precedes it is undecided", () => {
    const withoutDistress = allDecided("loss_making").filter(
      (item) => item.profile !== "distressed",
    );

    expect(select(withoutDistress)).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      requiredInputs: ["profile_evidence.distressed"],
      activatedRules: ["persistent_losses"],
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("selects the residual mature profile once every signal is explicitly absent", () => {
    expect(select(allDecided())).toMatchObject({
      status: "selected",
      assetProfile: "non_financial_mature",
      recommendedMethod: "fcff_base",
      activatedRules: ["mature_non_financial"],
      unsupportedReasons: [],
      confidence: "high",
    });

    const missing = allDecided().filter((item) => item.profile !== "reit");
    expect(select(missing)).toMatchObject({
      status: "unsupported_method",
      assetProfile: null,
      requiredInputs: ["profile_evidence.reit"],
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("refuses mature evidence as a signal: maturity is only the residual", () => {
    expect(() =>
      select([
        {
          ...evidence("bank", true),
          profile: "non_financial_mature" as SignalProfile,
        },
      ]),
    ).toThrow();
  });

  it("names missing structural FCFF inputs", () => {
    expect(select(allDecided(), { fcffInputsComplete: false })).toMatchObject({
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

  it("grades confidence ordinally, never as a probability", () => {
    expect(select(allDecided("cyclical", "high_growth")).confidence).toBe(
      "medium",
    );

    const alternativeNegative = allDecided("cyclical", "high_growth").map(
      (item) =>
        item.profile === "distressed"
          ? evidence("distressed", false, undefined, "declared_alternative")
          : item,
    );
    expect(select(alternativeNegative).confidence).toBe("low");

    // Una alternativa por debajo del perfil elegido no decidió nada.
    const alternativeBelow = allDecided("cyclical").map((item) =>
      item.profile === "high_growth"
        ? evidence("high_growth", false, undefined, "declared_alternative")
        : item,
    );
    expect(select(alternativeBelow).confidence).toBe("high");

    expect(select([]).confidence).toBeNull();
    expect(
      select([evidence("bank", true), evidence("reit", true)]).confidence,
    ).toBeNull();
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
