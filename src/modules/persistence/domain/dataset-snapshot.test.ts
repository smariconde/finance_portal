import { describe, expect, it } from "vitest";

import { datasetSnapshotSchema } from "./dataset-snapshot";

const validSnapshot = {
  snapshotId: "0198c7b4-6f18-7a12-933f-1972477dc769",
  datasetId: "demo.catalog",
  version: "fixture-v1",
  validFrom: "2026-08-21T00:00:00.000Z",
  validTo: null,
  availableAt: "2026-08-21T00:00:00.000Z",
  supersededAt: null,
  recordedAt: "2026-08-21T00:00:00.000Z",
  manifest: null,
  manifestStatus: "not_provided",
  contentHash: "a".repeat(64),
} as const;

describe("datasetSnapshotSchema", () => {
  it("preserves stable identity, temporal fields, and an explicit missing value", () => {
    expect(datasetSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot);
  });

  it("rejects closed or reversed effective intervals", () => {
    const result = datasetSnapshotSchema.safeParse({
      ...validSnapshot,
      validTo: validSnapshot.validFrom,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a silent missing manifest", () => {
    const result = datasetSnapshotSchema.safeParse({
      ...validSnapshot,
      manifestStatus: "stored",
    });

    expect(result.success).toBe(false);
  });
});
