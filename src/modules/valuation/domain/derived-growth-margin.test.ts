import { describe, expect, it } from "vitest";

import { referenceReleaseSchema } from "@/modules/reference-data/domain/reference-release";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { GROWTH_MARGIN_FIELD, growthMarginAt } from "./derived-growth-margin";

const observedAt = "2026-10-28T22:21:51.434Z";
const release = referenceReleaseSchema.parse({
  releaseId: "d5ee9466-6666-4329-9732-b9809ca4f169",
  datasetId: "damodaran.margins-us",
  parserVersion: "damodaran-html-1.1.0",
  rowCount: 1,
  ingestionRunId: "e5ee9466-6666-4329-9732-b9809ca4f169",
  publishedLabel: "January 2026",
  validFrom: observedAt,
  validTo: null,
  availableAt: observedAt,
  supersededAt: null,
  sourceId: "damodaran-current-data",
  sourceDocumentId:
    "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/margin.html",
  contentHash: "a".repeat(64),
  recordedAt: observedAt,
});
const query = (at: string) =>
  pointInTimeQuerySchema.parse({
    effectiveAt: at,
    knownAt: at,
    revisionPolicy: "as_known",
    knowledgeBasis: "public_availability",
    adjustmentPolicy: "as_known",
    sourcePolicyVersion: "source-policy-1.0.0",
  });
const reading = (value: string | null) => ({
  release,
  rows: [
    {
      key: "semiconductor",
      label: "Semiconductor",
      values: { [GROWTH_MARGIN_FIELD]: value },
    },
  ],
});

describe("growthMarginAt", () => {
  it("freezes the visible industry's pretax adjusted margin and release", () => {
    expect(
      growthMarginAt(reading("0.225"), "semiconductor", query(observedAt)),
    ).toEqual({
      status: "ready",
      reference: {
        datasetId: "damodaran.margins-us",
        releaseId: release.releaseId,
        rowKey: "semiconductor",
        field: GROWTH_MARGIN_FIELD,
        value: "0.225",
        publishedLabel: "January 2026",
        availableAt: observedAt,
        recordedAt: observedAt,
      },
    });
  });

  it("does not use a January label before the October observation", () => {
    expect(
      growthMarginAt(
        reading("0.225"),
        "semiconductor",
        query("2026-10-28T22:21:51.433Z"),
      ),
    ).toEqual({
      status: "unavailable",
      reason: "release_missing",
    });
  });

  it.each([null, "0", "-0.2", "1.1", "NaN", "Infinity"])(
    "refuses missing or invalid target %s",
    (value) => {
      expect(
        growthMarginAt(reading(value), "semiconductor", query(observedAt))
          .status,
      ).toBe("unavailable");
    },
  );

  it("refuses a missing or duplicate industry instead of taking a neighbor", () => {
    expect(
      growthMarginAt(reading("0.225"), "software", query(observedAt)),
    ).toEqual({
      status: "unavailable",
      reason: "margin_missing",
    });
    expect(
      growthMarginAt(
        {
          ...reading("0.225"),
          rows: [reading("0.225").rows[0]!, reading("0.3").rows[0]!],
        },
        "semiconductor",
        query(observedAt),
      ),
    ).toEqual({
      status: "unavailable",
      reason: "margin_missing",
    });
  });
});
