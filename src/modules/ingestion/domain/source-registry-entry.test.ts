import { describe, expect, it } from "vitest";

import {
  evaluateIngestionRights,
  sourceRegistryEntrySchema,
  sourceRightsSchema,
  type SourceRegistryEntry,
} from "./source-registry-entry";

const RECORDED_AT = "2026-08-23T00:00:00.000Z";

function entry(
  overrides: Partial<Record<string, unknown>> = {},
): SourceRegistryEntry {
  return sourceRegistryEntrySchema.parse({
    sourceId: "fixture-demo-fundamentals",
    displayName: "Fixture sintética",
    owner: "Portal Financiero",
    canonicalUrl: "https://fixtures.invalid/demo",
    documentationUrls: [],
    datasets: ["demo.fundamentals.annual"],
    endpoints: [],
    authentication: "none",
    applicablePlan: null,
    rateLimit: null,
    attribution: null,
    expectedCadence: "estática",
    freshnessTarget: "no aplica",
    timezone: "UTC",
    units: ["monetary"],
    currencies: ["USD"],
    parserVersion: "fixture-1.0.0",
    fixturePolicy: "sintética y versionada",
    fallbackSourceIds: [],
    rights: {
      personalUse: "allowed",
      automatedAccess: "allowed",
      rawStorage: "allowed",
      normalizedStorage: "allowed",
      derivedStorage: "allowed",
      publicDisplay: "allowed",
      export: "allowed",
      aiTransfer: "restricted",
    },
    technicalStatus: "integrated",
    approvalStatus: "approved_public_demo",
    reviewedAt: RECORDED_AT,
    rightsReviewedAt: RECORDED_AT,
    rightsReviewDueAt: null,
    reviewEvidence: [],
    retentionClasses: ["R0"],
    quotaPolicyId: null,
    ownerNotes: "",
    recordedAt: RECORDED_AT,
    ...overrides,
  });
}

const PERSONAL_RUN = {
  storesRawPayload: true,
  storesNormalizedValues: true,
  publicDisplay: false,
};

describe("sourceRightsSchema", () => {
  it("defaults every unstated right to unknown", () => {
    expect(sourceRightsSchema.parse({})).toStrictEqual({
      personalUse: "unknown",
      automatedAccess: "unknown",
      rawStorage: "unknown",
      normalizedStorage: "unknown",
      derivedStorage: "unknown",
      publicDisplay: "unknown",
      export: "unknown",
      aiTransfer: "unknown",
    });
  });
});

describe("sourceRegistryEntrySchema", () => {
  it("rejects an approved source without a recorded rights review", () => {
    expect(() => entry({ rightsReviewedAt: null })).toThrow();
  });

  it("rejects approved_public_demo without public display rights", () => {
    expect(() =>
      entry({
        rights: { ...entry().rights, publicDisplay: "restricted" },
      }),
    ).toThrow();
  });

  it("rejects a source declared as its own fallback", () => {
    expect(() =>
      entry({ fallbackSourceIds: ["fixture-demo-fundamentals"] }),
    ).toThrow();
  });
});

describe("evaluateIngestionRights", () => {
  it("allows a fully approved synthetic source", () => {
    expect(evaluateIngestionRights(entry(), PERSONAL_RUN)).toStrictEqual({
      allowed: true,
      blockedBy: [],
    });
  });

  it("fails closed when rights are unknown", () => {
    const candidate = entry({
      technicalStatus: "technical_reviewed",
      approvalStatus: "rights_review_pending",
      rightsReviewedAt: null,
      rights: {},
    });

    const evaluation = evaluateIngestionRights(candidate, PERSONAL_RUN);

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.blockedBy).toContain("rights.automatedAccess:unknown");
    expect(evaluation.blockedBy).toContain(
      "approval_status:rights_review_pending",
    );
    expect(evaluation.blockedBy).toContain(
      "technical_status:technical_reviewed",
    );
  });

  it("only requires storage rights that the run actually exercises", () => {
    const candidate = entry({
      rights: { ...entry().rights, rawStorage: "restricted" },
    });

    expect(
      evaluateIngestionRights(candidate, PERSONAL_RUN).blockedBy,
    ).toContain("rights.rawStorage:restricted");
    expect(
      evaluateIngestionRights(candidate, {
        ...PERSONAL_RUN,
        storesRawPayload: false,
      }).allowed,
    ).toBe(true);
  });

  it("blocks public display unless the source is approved for a public demo", () => {
    const candidate = entry({
      approvalStatus: "approved_personal",
    });

    expect(
      evaluateIngestionRights(candidate, {
        ...PERSONAL_RUN,
        publicDisplay: true,
      }).blockedBy,
    ).toContain("public_display_requires_approved_public_demo");
  });

  it("blocks a suspended source even with approved rights", () => {
    const candidate = entry({ technicalStatus: "suspended" });

    expect(
      evaluateIngestionRights(candidate, PERSONAL_RUN).blockedBy,
    ).toContain("technical_status:suspended");
  });
});
