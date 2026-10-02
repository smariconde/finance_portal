import { describe, expect, it } from "vitest";

import appleSubmissions from "@/modules/fundamentals/infrastructure/golden/0000320193/submissions.json";

import { selectValuationMethod } from "../domain/method-selection";
import { constituteSecSicProfile } from "./sec-sic-profile";

const LEGAL_ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const FETCHED_AT = "2026-10-02T12:00:00.000Z";
const RECORDED_AT = "2026-10-02T12:00:01.000Z";

function request(overrides: Record<string, string> = {}) {
  return {
    legalEntityId: LEGAL_ENTITY_ID,
    expectedCik: "0000320193",
    fetchedAt: FETCHED_AT,
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

describe("SEC SIC profile rule 1.0.0", () => {
  it.each([
    ["6021", "bank"],
    ["6022", "bank"],
    ["6035", "bank"],
    ["6311", "insurer"],
    ["6331", "insurer"],
    ["6399", "insurer"],
    ["6798", "reit"],
  ] as const)("maps SEC SIC %s to %s with source lineage", (sic, profile) => {
    const result = constituteSecSicProfile(
      { ...appleSubmissions, sic },
      request(),
    );

    expect(result).toMatchObject({
      status: "mapped",
      sic,
      evidence: {
        legalEntityId: LEGAL_ENTITY_ID,
        profile,
        present: true,
        validFrom: FETCHED_AT,
        availableAt: FETCHED_AT,
        recordedAt: RECORDED_AT,
        sourceId: "sec-edgar",
        sourceDocumentId: "submissions/CIK0000320193.json",
      },
    });
    if (result.status !== "mapped") return;
    expect(result.evidence.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("leaves the frozen Apple SIC 3571 unclassified", () => {
    expect(constituteSecSicProfile(appleSubmissions, request())).toMatchObject({
      status: "unmapped",
      sic: "3571",
      evidence: null,
    });
  });

  it("does not infer a subtype from a broad real estate SIC", () => {
    expect(
      constituteSecSicProfile({ ...appleSubmissions, sic: "6500" }, request()),
    ).toMatchObject({ status: "unmapped", evidence: null });
  });

  it("refuses missing or malformed SIC without turning it into a negative signal", () => {
    const withoutSic = Object.fromEntries(
      Object.entries(appleSubmissions).filter(([key]) => key !== "sic"),
    );
    expect(constituteSecSicProfile(withoutSic, request())).toMatchObject({
      status: "rejected",
      reason: "sic_invalid",
      evidence: null,
    });
    expect(
      constituteSecSicProfile(
        { ...appleSubmissions, sic: "6021<script>" },
        request(),
      ),
    ).toMatchObject({
      status: "rejected",
      reason: "sic_invalid",
      evidence: null,
    });
  });

  it("refuses a filer mismatch and a broken submissions envelope", () => {
    expect(
      constituteSecSicProfile(
        appleSubmissions,
        request({ expectedCik: "0000000042" }),
      ),
    ).toMatchObject({ status: "rejected", reason: "cik_mismatch" });
    expect(constituteSecSicProfile({}, request())).toMatchObject({
      status: "rejected",
      reason: "submissions_invalid",
    });
  });

  it("does not record a signal before the SEC response was fetched", () => {
    expect(
      constituteSecSicProfile(
        { ...appleSubmissions, sic: "6021" },
        request({ recordedAt: "2026-10-02T11:59:59.000Z" }),
      ),
    ).toMatchObject({ status: "rejected", reason: "recorded_before_fetch" });
  });

  it("does not let a present-day SIC classify an earlier historical cutoff", () => {
    const mapped = constituteSecSicProfile(
      { ...appleSubmissions, sic: "6021" },
      request(),
    );
    expect(mapped.status).toBe("mapped");
    if (mapped.status !== "mapped") return;

    const selection = selectValuationMethod({
      legalEntityId: LEGAL_ENTITY_ID,
      knowledge: {
        effectiveAt: "2025-12-31T00:00:00.000Z",
        knownAt: "2025-12-31T00:00:00.000Z",
        revisionPolicy: "as_known",
        adjustmentPolicy: "as_known",
        knowledgeBasis: "public_availability",
        sourcePolicyVersion: "source-policy-1.0.0",
      },
      evidence: [mapped.evidence],
      fcffInputsComplete: false,
    });

    expect(selection).toMatchObject({
      assetProfile: null,
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });
});
