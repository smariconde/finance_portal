import { describe, expect, it } from "vitest";

import { ingestionRunSchema } from "@/modules/ingestion/domain/ingestion-run";

import { createInMemoryIngestionRunRepository } from "./in-memory-ingestion-run-repository";

function anchoredRun(
  runId: string,
  recordedAt: string,
  selectionAnchorOn: string | null,
) {
  return ingestionRunSchema.parse({
    runId,
    sourceId: "sec-edgar",
    datasetId: "companyfacts",
    parserVersion: "sec-companyfacts-1.0.0",
    idempotencyKey: runId.replaceAll("-", "").padEnd(64, "a"),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: "0000320193",
    selectionVersion:
      selectionAnchorOn === null ? null : "sec-core-concepts-2.0.0",
    selectionAnchorOn,
    status: "empty",
    startedAt: recordedAt,
    finishedAt: recordedAt,
    counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
    contentHash: "b".repeat(64),
    failure: null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt,
  });
}

describe("historical ingestion anchors", () => {
  it("selects the last recorded anchor at the cutoff, including its boundary", async () => {
    const first = anchoredRun(
      "11111111-1111-4111-8111-111111111111",
      "2024-01-20T10:00:00.000Z",
      "2023-12-31",
    );
    const second = anchoredRun(
      "22222222-2222-4222-8222-222222222222",
      "2025-01-20T10:00:00.000Z",
      "2024-12-31",
    );
    const unanchored = anchoredRun(
      "33333333-3333-4333-8333-333333333333",
      "2025-06-20T10:00:00.000Z",
      null,
    );
    const repository = createInMemoryIngestionRunRepository([
      first,
      second,
      unanchored,
    ]);
    const at = (knownAt: string) =>
      repository.findLatestAnchoredAt(
        "sec-edgar",
        "companyfacts",
        "0000320193",
        knownAt,
      );

    expect(await at("2024-01-20T09:59:59.999Z")).toBeNull();
    expect(await at(first.recordedAt)).toEqual(first);
    expect(await at("2025-01-20T09:59:59.999Z")).toEqual(first);
    expect(await at(second.recordedAt)).toEqual(second);
    expect(await at(unanchored.recordedAt)).toEqual(second);
  });
});
