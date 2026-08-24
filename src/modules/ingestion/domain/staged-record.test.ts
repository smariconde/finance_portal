import { describe, expect, it } from "vitest";

import {
  computeStagedBatchHash,
  stagedRecordSchema,
  type StagedRecord,
} from "./staged-record";

const IDENTITY = {
  sourceId: "fixture-demo-fundamentals",
  datasetId: "demo.fundamentals.annual",
  parserVersion: "fixture-1.0.0",
};

function record(overrides: Record<string, unknown> = {}): StagedRecord {
  return stagedRecordSchema.parse({
    externalId: "fixtureco-2024-revenue",
    concept: "Revenues",
    subjectKey: "fixtureco",
    metricId: "revenue",
    asOf: "2024-12-31",
    periodStart: "2024-01-01",
    periodEnd: "2024-12-31",
    periodType: "annual",
    unit: "monetary",
    currency: "USD",
    rawValue: "100000000",
    rawValueStatus: "stored",
    availableAt: "2025-02-20T21:00:00.000Z",
    sourceDocumentId: "fixtureco-fy2024-annual-report",
    qualityFlags: [],
    ...overrides,
  });
}

describe("stagedRecordSchema", () => {
  it("keeps a missing value null with its reason instead of coercing it", () => {
    const parsed = record({
      rawValue: null,
      rawValueStatus: "not_provided",
      qualityFlags: ["missing_from_source"],
    });

    expect(parsed.rawValue).toBeNull();
    expect(parsed.rawValueStatus).toBe("not_provided");
  });

  it("rejects a value that claims to be stored without a raw value", () => {
    expect(() => record({ rawValue: null })).toThrow();
  });

  it("rejects a zero standing in for a value the source did not publish", () => {
    expect(() =>
      record({ rawValue: "0", rawValueStatus: "not_provided" }),
    ).toThrow();
  });

  it("rejects formatted numbers so a parser change cannot pass silently", () => {
    expect(() => record({ rawValue: "100,000,000" })).toThrow();
    expect(() => record({ rawValue: "1e8" })).toThrow();
  });

  it("accepts negative values", () => {
    expect(record({ rawValue: "-4200000" }).rawValue).toBe("-4200000");
  });

  it("requires an interval for a period observation", () => {
    expect(() => record({ periodStart: null })).toThrow();
    expect(() =>
      record({ periodStart: "2024-12-31", periodEnd: "2024-01-01" }),
    ).toThrow();
  });

  it("rejects an interval on an instant observation", () => {
    expect(() => record({ periodType: "instant" })).toThrow();
    expect(
      record({ periodType: "instant", periodStart: null, periodEnd: null })
        .periodType,
    ).toBe("instant");
  });

  it("requires a knowledge date on every record", () => {
    expect(() => record({ availableAt: null })).toThrow();
  });
});

describe("computeStagedBatchHash", () => {
  const first = record();
  const second = record({
    externalId: "fixtureco-2024-net-income",
    metricId: "net_income",
    rawValue: "-4200000",
  });

  it("does not depend on the order the source returned the records", () => {
    expect(computeStagedBatchHash(IDENTITY, [first, second])).toBe(
      computeStagedBatchHash(IDENTITY, [second, first]),
    );
  });

  it("changes when the parser version changes", () => {
    expect(computeStagedBatchHash(IDENTITY, [first])).not.toBe(
      computeStagedBatchHash({ ...IDENTITY, parserVersion: "fixture-1.0.1" }, [
        first,
      ]),
    );
  });

  it("distinguishes an empty batch from a populated one", () => {
    expect(computeStagedBatchHash(IDENTITY, [])).not.toBe(
      computeStagedBatchHash(IDENTITY, [first]),
    );
  });
});
