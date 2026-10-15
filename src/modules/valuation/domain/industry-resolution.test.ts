import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  industryResolutionRecordSchema,
  planIndustryAssertion,
  type IndustryResolutionRecord,
} from "./industry-resolution";

const SUBJECT = "00000000-0000-4000-8000-000000000042";

function resolutionRecord(
  overrides: Partial<IndustryResolutionRecord> = {},
): IndustryResolutionRecord {
  return {
    resolutionId: "00000000-0000-4000-8000-0000000000a1",
    legalEntityId: SUBJECT,
    cik: "0000000042",
    sic: "6021",
    candidates: ["bank-money-center", "banks-regional"],
    taskVersion: "industry-resolution-1.0.0",
    promptVersion: "industry-resolution-prompt-1.0.0",
    ladderVersion: "ai-model-ladder-1.0.0",
    sectionsVersion: "sec-10k-sections-1.0.0",
    outcome: "resolved",
    industryKey: "banks-regional",
    confidence: "high",
    rationale: "A regional bank.",
    reason: null,
    acceptedRung: 1,
    respondedModel: "deepseek/deepseek-v4.1-flash",
    citedEvidenceIds: ["E1"],
    resolvedAt: "2026-10-15T12:00:00.000Z",
    recordedAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

let ids = 0;
const plan = (
  resolution: IndustryResolutionRecord,
  stored: Parameters<typeof planIndustryAssertion>[0]["stored"] = [],
) =>
  planIndustryAssertion({
    resolution,
    industryLabel: "Banks (Regional)",
    stored,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    hashContent: (text) => createHash("sha256").update(text).digest("hex"),
  });

describe("industryResolutionRecordSchema", () => {
  it("keeps the key and the reason mutually exclusive, and the key a candidate", () => {
    expect(
      industryResolutionRecordSchema.safeParse(resolutionRecord()).success,
    ).toBe(true);

    for (const overrides of [
      { industryKey: null },
      { reason: "low_confidence" },
      { industryKey: "software-internet" },
      { outcome: "abstained" as const },
    ]) {
      expect(
        industryResolutionRecordSchema.safeParse(resolutionRecord(overrides))
          .success,
      ).toBe(false);
    }

    expect(
      industryResolutionRecordSchema.safeParse(
        resolutionRecord({
          outcome: "abstained",
          industryKey: null,
          reason: "insufficient_evidence",
        }),
      ).success,
    ).toBe(true);
  });
});

describe("planIndustryAssertion", () => {
  it("opens the assertion available only from the instant it was resolved", () => {
    const result = plan(resolutionRecord());
    const [opened] = result.opened;

    expect(result.counts).toMatchObject({ opened: 1, superseded: 0 });
    expect(opened).toMatchObject({
      taxonomyId: "damodaran-industry",
      taxonomyVersion: "industry-resolution-1.0.0",
      code: "banks-regional",
      label: "Banks (Regional)",
      validFrom: "2026-10-15T12:00:00.000Z",
      availableAt: "2026-10-15T12:00:00.000Z",
      sourceId: "openrouter",
      sourceDocumentId:
        "industry-resolution/00000000-0000-4000-8000-0000000000a1",
    });
  });

  it("opens nothing when the industry did not change, and supersedes when it did", () => {
    const first = plan(resolutionRecord()).opened[0]!;

    expect(
      plan(
        resolutionRecord({
          resolutionId: "00000000-0000-4000-8000-0000000000a2",
          resolvedAt: "2026-11-01T00:00:00.000Z",
          recordedAt: "2026-11-01T00:00:00.000Z",
        }),
        [first],
      ).counts,
    ).toMatchObject({ opened: 0, unchanged: 1 });

    const changed = plan(
      resolutionRecord({
        resolutionId: "00000000-0000-4000-8000-0000000000a3",
        industryKey: "bank-money-center",
        resolvedAt: "2026-11-01T00:00:00.000Z",
        recordedAt: "2026-11-01T00:00:00.000Z",
      }),
      [first],
    );

    expect(changed.supersessions).toEqual([
      {
        subjectId: SUBJECT,
        validFrom: first.validFrom,
        supersededAt: "2026-11-01T00:00:00.000Z",
        previousCode: "banks-regional",
        nextCode: "bank-money-center",
      },
    ]);
  });

  it("refuses to assert an abstention or to supersede into the past", () => {
    expect(() =>
      plan(
        resolutionRecord({
          outcome: "abstained",
          industryKey: null,
          reason: "low_confidence",
        }),
      ),
    ).toThrow(/Only a resolved industry/);

    const first = plan(resolutionRecord()).opened[0]!;

    expect(() =>
      plan(
        resolutionRecord({
          industryKey: "bank-money-center",
          resolvedAt: "2026-10-01T00:00:00.000Z",
          recordedAt: "2026-10-01T00:00:00.000Z",
        }),
        [first],
      ),
    ).toThrow(/does not follow/);
  });
});
