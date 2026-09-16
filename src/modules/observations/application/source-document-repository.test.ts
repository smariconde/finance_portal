import { describe, expect, it } from "vitest";

import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocument,
  type SourceDocumentContent,
} from "../domain/source-document";
import { createInMemorySourceDocumentRepository } from "../infrastructure/in-memory-source-document-repository";
import { classifySourceDocuments } from "./source-document-repository";

function filing(
  accession: string,
  overrides: Partial<SourceDocumentContent> = {},
): SourceDocument {
  const content: SourceDocumentContent = {
    sourceId: "sec-edgar",
    sourceDocumentId: accession,
    documentType: "10-Q",
    subjectType: "legal_entity",
    subjectId: "00000000-0000-4000-8000-00000000e001",
    publishedOn: "2025-05-02",
    acceptedAt: "2025-05-01T20:05:00.000Z",
    availableAt: "2025-05-01T20:05:00.000Z",
    availabilityRule: "sec_acceptance",
    periodEndOn: "2025-03-31",
    fiscalYear: 2025,
    fiscalPeriod: "Q1",
    ...overrides,
  };

  return sourceDocumentSchema.parse({
    ...content,
    contentHash: computeSourceDocumentContentHash(content),
    ingestionRunId: "00000000-0000-4000-8000-000000000001",
    recordedAt: "2026-09-14T12:00:00.000Z",
  });
}

describe("classifySourceDocuments", () => {
  it("inserts absent documents and leaves identical ones unchanged", () => {
    const stored = filing("0000000001-25-000001");
    const result = classifySourceDocuments(
      [stored, filing("0000000001-25-000002")],
      [stored],
    );

    expect(
      result.toInsert.map((document) => document.sourceDocumentId),
    ).toEqual(["0000000001-25-000002"]);
    expect(result.unchanged).toEqual(["0000000001-25-000001"]);
    expect(result.conflicts).toEqual([]);
  });

  it("reports a document described differently instead of rewriting it", () => {
    const result = classifySourceDocuments(
      [filing("0000000001-25-000001", { documentType: "10-Q/A" })],
      [filing("0000000001-25-000001")],
    );

    expect(result.toInsert).toEqual([]);
    expect(result.conflicts).toEqual(["0000000001-25-000001"]);
  });

  it("refuses to insert a document that one batch describes two ways", () => {
    const result = classifySourceDocuments(
      [
        filing("0000000001-25-000003"),
        filing("0000000001-25-000003", { fiscalPeriod: "Q2" }),
      ],
      [],
    );

    expect(result.toInsert).toEqual([]);
    expect(result.conflicts).toEqual(["0000000001-25-000003"]);
  });
});

describe("in-memory source document repository", () => {
  it("never overwrites a recorded document", async () => {
    const repository = createInMemorySourceDocumentRepository();
    await repository.record([filing("0000000001-25-000001")]);

    const second = await repository.record([
      filing("0000000001-25-000001", { acceptedAt: null }),
    ]);
    const [stored] = await repository.findByIds({
      sourceId: "sec-edgar",
      sourceDocumentIds: ["0000000001-25-000001"],
    });

    expect(second.conflicts).toEqual(["0000000001-25-000001"]);
    expect(stored?.acceptedAt).toBe("2025-05-01T20:05:00.000Z");
  });
});
