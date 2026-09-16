import { describe, expect, it } from "vitest";

import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocumentContent,
} from "./source-document";

const CONTENT: SourceDocumentContent = {
  sourceId: "sec-edgar",
  sourceDocumentId: "0000000001-25-000010",
  documentType: "10-K",
  subjectType: "legal_entity",
  subjectId: "00000000-0000-4000-8000-00000000e001",
  publishedOn: "2025-02-21",
  acceptedAt: "2025-02-20T21:30:00.000Z",
  availableAt: "2025-02-20T21:30:00.000Z",
  availabilityRule: "sec_acceptance",
  periodEndOn: "2024-12-31",
  fiscalYear: 2024,
  fiscalPeriod: "FY",
};

function document(overrides: Partial<Record<string, unknown>> = {}) {
  return sourceDocumentSchema.parse({
    ...CONTENT,
    contentHash: computeSourceDocumentContentHash(CONTENT),
    ingestionRunId: "00000000-0000-4000-8000-000000000001",
    recordedAt: "2026-09-14T12:00:00.000Z",
    ...overrides,
  });
}

describe("sourceDocumentSchema", () => {
  it("accepts a filing with its acceptance instant and fiscal focus", () => {
    expect(document().documentType).toBe("10-K");
  });

  it("rejects a document that claims to be knowable before it was accepted", () => {
    expect(() =>
      document({ availableAt: "2025-02-20T21:29:59.000Z" }),
    ).toThrow();
  });

  it("keeps a document without acceptance or fiscal focus as nulls", () => {
    const parsed = document({
      acceptedAt: null,
      fiscalYear: null,
      fiscalPeriod: null,
      periodEndOn: null,
    });

    expect(parsed.acceptedAt).toBeNull();
    expect(parsed.fiscalPeriod).toBeNull();
  });

  it("rejects an availability rule that is not a stable identifier", () => {
    expect(() => document({ availabilityRule: "Acceptance time" })).toThrow();
  });
});

describe("computeSourceDocumentContentHash", () => {
  it("hashes the same filing identically regardless of the run that saw it", () => {
    expect(computeSourceDocumentContentHash(CONTENT)).toBe(
      computeSourceDocumentContentHash({ ...CONTENT }),
    );
  });

  it("does not depend on how the same instant is spelled", () => {
    expect(
      computeSourceDocumentContentHash({
        ...CONTENT,
        acceptedAt: "2025-02-20T21:30:00Z",
        availableAt: "2025-02-20T21:30:00+00:00",
      }),
    ).toBe(computeSourceDocumentContentHash(CONTENT));
  });

  it("changes when the acceptance instant changes", () => {
    expect(
      computeSourceDocumentContentHash({
        ...CONTENT,
        acceptedAt: "2025-02-20T21:31:00.000Z",
        availableAt: "2025-02-20T21:31:00.000Z",
      }),
    ).not.toBe(computeSourceDocumentContentHash(CONTENT));
  });
});
