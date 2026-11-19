import { describe, expect, it } from "vitest";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { DECLARED_PROFILES } from "../application/declared-profiles";
import {
  applyProfileDeclarations,
  DECLARED_PROFILE_RULE_VERSION,
  type ProfileDeclaration,
} from "./declared-profile";
import {
  selectValuationMethod,
  type ProfileEvidence,
} from "./method-selection";

const ENTITY = "00000000-0000-4000-8000-0000000000aa";
const CIK = "0000723125";
const declaration: ProfileDeclaration = {
  cik: CIK,
  ticker: "MU",
  profile: "cyclical",
  decidedBy: "owner",
  declaredAt: "2026-11-19T14:00:00.000Z",
  rationale: "Memory is a manufactured commodity that follows its price cycle.",
};

function evidence(profile: ProfileEvidence["profile"], present: boolean) {
  return {
    legalEntityId: ENTITY,
    profile,
    present,
    rule: "sec-sic-profile-2.0.0",
    derivation: "primary" as const,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
    availableAt: "2020-01-01T00:00:00.000Z",
    supersededAt: null,
    recordedAt: "2020-01-01T00:00:00.000Z",
    sourceId: "sec-edgar",
    sourceDocumentId: null,
    contentHash: computeContentHash({ profile, present }),
  };
}

/** MU's evidence before the declaration: no SIC cycle, high growth. */
const MU_EVIDENCE: ProfileEvidence[] = [
  evidence("bank", false),
  evidence("insurer", false),
  evidence("reit", false),
  evidence("holding", false),
  evidence("distressed", false),
  evidence("commodity", false),
  evidence("cyclical", false),
  evidence("loss_making", false),
  evidence("high_growth", true),
];
const at = (instant: string) => ({ knownAt: instant, effectiveAt: instant });
const select = (items: readonly ProfileEvidence[], instant: string) =>
  selectValuationMethod({
    legalEntityId: ENTITY,
    knowledge: {
      effectiveAt: instant,
      knownAt: instant,
      revisionPolicy: "as_known",
      adjustmentPolicy: "as_known",
      sourcePolicyVersion: "source-policy-1.0.0",
    },
    evidence: [...items],
    fcffInputsComplete: true,
    growthFcffMissingInputs: [],
    normalizedFcffMissingInputs: [],
  });

describe(DECLARED_PROFILE_RULE_VERSION, () => {
  it("replaces the SIC's cycle evidence once visible, so MU is valued on its cycle", () => {
    const now = "2026-11-20T00:00:00.000Z";
    const applied = applyProfileDeclarations(
      MU_EVIDENCE,
      [declaration],
      { legalEntityId: ENTITY, cik: CIK },
      at(now),
    );
    expect(applied.filter((item) => item.profile === "cyclical")).toEqual([
      expect.objectContaining({
        present: true,
        rule: DECLARED_PROFILE_RULE_VERSION,
      }),
    ]);
    expect(select(MU_EVIDENCE, now)).toMatchObject({
      assetProfile: "high_growth",
    });
    expect(select(applied, now)).toMatchObject({
      assetProfile: "cyclical",
      recommendedMethod: "normalized_fcff",
    });
  });

  it("changes nothing before it was declared or for another CIK", () => {
    expect(
      applyProfileDeclarations(
        MU_EVIDENCE,
        [declaration],
        { legalEntityId: ENTITY, cik: CIK },
        at("2026-11-18T00:00:00.000Z"),
      ),
    ).toBe(MU_EVIDENCE);
    expect(
      applyProfileDeclarations(
        MU_EVIDENCE,
        [declaration],
        { legalEntityId: ENTITY, cik: "0001045810" },
        at("2026-11-20T00:00:00.000Z"),
      ),
    ).toBe(MU_EVIDENCE);
  });

  it("declares only Micron, as cyclical", () => {
    expect(
      DECLARED_PROFILES.map((item) => [item.ticker, item.profile]),
    ).toEqual([["MU", "cyclical"]]);
  });
});
