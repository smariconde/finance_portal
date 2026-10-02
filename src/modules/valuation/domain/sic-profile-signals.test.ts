import { describe, expect, it } from "vitest";

import { selectValuationMethod } from "./method-selection";
import {
  assessSicProfiles,
  SEC_SIC_PROFILE_RULE_VERSION,
  sicProfileEvidence,
  type SicAssertion,
} from "./sic-profile-signals";

const LEGAL_ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-10-02T12:00:00.000Z";

function assertion(sic: string): SicAssertion {
  return {
    legalEntityId: LEGAL_ENTITY_ID,
    sic,
    validFrom: OBSERVED_AT,
    validTo: null,
    availableAt: OBSERVED_AT,
    supersededAt: null,
    recordedAt: OBSERVED_AT,
    sourceId: "sec-edgar",
    sourceDocumentId: "submissions/CIK0000320193.json",
    contentHash: "b".repeat(64),
  };
}

describe(SEC_SIC_PROFILE_RULE_VERSION, () => {
  it.each([
    ["6021", "bank"],
    ["6022", "bank"],
    ["6035", "bank"],
    ["6311", "insurer"],
    ["6331", "insurer"],
    ["6399", "insurer"],
    ["6798", "reit"],
  ] as const)(
    "maps SEC SIC %s to %s and rules out the other financial profiles",
    (sic, profile) => {
      const assessment = assessSicProfiles(sic);

      expect(assessment[profile]).toBe(true);
      for (const other of ["bank", "insurer", "reit", "holding"] as const) {
        if (other !== profile) expect(assessment[other]).toBe(false);
      }
    },
  );

  it("treats a SIC outside the finance division as evidence against every financial profile", () => {
    expect(assessSicProfiles("3571")).toStrictEqual({
      commodity: false,
      cyclical: false,
      bank: false,
      insurer: false,
      reit: false,
      holding: false,
    });
  });

  it("proves nothing about financial profiles for an unmapped finance code", () => {
    for (const sic of ["6211", "6199", "6324", "6500"]) {
      expect(assessSicProfiles(sic)).toStrictEqual({
        commodity: false,
        cyclical: false,
      });
    }
  });

  it.each([
    ["1311", "commodity"],
    ["1040", "commodity"],
    ["2911", "commodity"],
    ["3531", "cyclical"],
    ["3711", "cyclical"],
    ["4400", "cyclical"],
  ] as const)("marks SIC %s as %s by industry", (sic, profile) => {
    expect(assessSicProfiles(sic)[profile]).toBe(true);
  });

  it("dates every signal with the assertion it came from", () => {
    const evidence = sicProfileEvidence(assertion("6021"));

    expect(evidence).toHaveLength(6);
    for (const item of evidence) {
      expect(item).toMatchObject({
        legalEntityId: LEGAL_ENTITY_ID,
        rule: SEC_SIC_PROFILE_RULE_VERSION,
        derivation: "primary",
        validFrom: OBSERVED_AT,
        availableAt: OBSERVED_AT,
        sourceId: "sec-edgar",
      });
      expect(item.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("does not let a present-day SIC classify an earlier historical cutoff", () => {
    const knowledge = {
      effectiveAt: "2025-12-31T00:00:00.000Z",
      knownAt: "2025-12-31T00:00:00.000Z",
      revisionPolicy: "as_known" as const,
      adjustmentPolicy: "as_known" as const,
      knowledgeBasis: "public_availability" as const,
      sourcePolicyVersion: "source-policy-1.0.0",
    };

    expect(
      selectValuationMethod({
        legalEntityId: LEGAL_ENTITY_ID,
        knowledge,
        evidence: [...sicProfileEvidence(assertion("6021"))],
        fcffInputsComplete: false,
      }),
    ).toMatchObject({
      assetProfile: null,
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });
});
