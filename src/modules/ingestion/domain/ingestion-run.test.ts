import { describe, expect, it } from "vitest";

import {
  computeIdempotencyKey,
  ingestionRunSchema,
  isPublishableStatus,
  type IngestionRunStatus,
} from "./ingestion-run";

const STARTED_AT = "2026-08-23T10:00:00.000Z";
const FINISHED_AT = "2026-08-23T10:00:01.000Z";
const HASH = "a".repeat(64);

function run(overrides: Record<string, unknown> = {}) {
  return ingestionRunSchema.parse({
    runId: "00000000-0000-4000-8000-000000000001",
    sourceId: "fixture-demo-fundamentals",
    datasetId: "demo.fundamentals.annual",
    parserVersion: "fixture-1.0.0",
    idempotencyKey: "b".repeat(64),
    requestedAsOf: null,
    cursor: null,
    nextCursor: null,
    status: "succeeded",
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    counts: { fetched: 5, accepted: 5, rejected: 0, duplicate: 0 },
    contentHash: HASH,
    failure: null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: FINISHED_AT,
    ...overrides,
  });
}

describe("ingestionRunSchema", () => {
  it("accepts a succeeded run whose counts add up", () => {
    expect(run().status).toBe("succeeded");
  });

  it("rejects counts that do not add up to fetched", () => {
    expect(() =>
      run({ counts: { fetched: 5, accepted: 4, rejected: 0, duplicate: 0 } }),
    ).toThrow();
  });

  it("rejects a succeeded run that rejected records", () => {
    expect(() =>
      run({ counts: { fetched: 5, accepted: 4, rejected: 1, duplicate: 0 } }),
    ).toThrow();
  });

  it("requires a running run to stay open and empty", () => {
    expect(() =>
      run({
        status: "running",
        finishedAt: null,
        contentHash: null,
        counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
      }),
    ).not.toThrow();
    expect(() => run({ status: "running", contentHash: null })).toThrow();
  });

  it("requires a safe failure exactly for the failed status", () => {
    expect(() =>
      run({
        status: "failed",
        contentHash: null,
        counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
        failure: null,
      }),
    ).toThrow();
    expect(() =>
      run({
        failure: { code: "provider_error", message: "caída", retryable: true },
      }),
    ).toThrow();
  });

  it("forbids a content hash on a failed run", () => {
    expect(() =>
      run({
        status: "failed",
        counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
        failure: {
          code: "provider_error",
          message: "caída",
          retryable: true,
        },
      }),
    ).toThrow();
  });

  it("rejects a finishedAt earlier than startedAt", () => {
    expect(() => run({ finishedAt: "2026-08-23T09:59:59.000Z" })).toThrow();
  });

  it("rejects an empty run that reports fetched records", () => {
    expect(() =>
      run({
        status: "empty",
        counts: { fetched: 3, accepted: 0, rejected: 0, duplicate: 3 },
      }),
    ).toThrow();
  });

  it("accepts a quarantined batch where nothing was accepted", () => {
    expect(
      run({
        status: "quarantined",
        counts: { fetched: 2, accepted: 0, rejected: 2, duplicate: 0 },
        qualityFlags: ["parser_broken"],
      }).status,
    ).toBe("quarantined");
  });
});

describe("isPublishableStatus", () => {
  it("only publishes statuses that actually produced accepted records", () => {
    const expected: Record<IngestionRunStatus, boolean> = {
      running: false,
      succeeded: true,
      partial: true,
      empty: false,
      duplicate: false,
      quarantined: false,
      failed: false,
    };

    for (const [status, publishable] of Object.entries(expected)) {
      expect(isPublishableStatus(status as IngestionRunStatus)).toBe(
        publishable,
      );
    }
  });
});

describe("computeIdempotencyKey", () => {
  const key = {
    sourceId: "fixture-demo-fundamentals",
    datasetId: "demo.fundamentals.annual",
    parserVersion: "fixture-1.0.0",
    requestedAsOf: "2024-12-31",
    cursor: null,
  };

  it("is stable for the same dataset, as-of, cursor and parser", () => {
    expect(computeIdempotencyKey(key)).toBe(computeIdempotencyKey({ ...key }));
  });

  it("changes when the parser version changes", () => {
    expect(computeIdempotencyKey(key)).not.toBe(
      computeIdempotencyKey({ ...key, parserVersion: "fixture-1.0.1" }),
    );
  });

  it("changes when the cursor advances", () => {
    expect(computeIdempotencyKey(key)).not.toBe(
      computeIdempotencyKey({ ...key, cursor: "offset:500" }),
    );
  });
});
