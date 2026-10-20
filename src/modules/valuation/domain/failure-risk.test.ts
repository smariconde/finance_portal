import { describe, expect, it } from "vitest";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { fixtureCostOfCapitalReadings } from "../infrastructure/fixture-cost-of-capital-readings";
import {
  buildFailureRisk,
  failureProbability,
  failureRatingBucket,
  failureRiskMismatches,
  FAILURE_RATES_DATASET,
  type FailureRisk,
} from "./failure-risk";

const knowledge = pointInTimeQuerySchema.parse({
  ...DEMO_VALUATION_INPUT.knowledge,
  effectiveAt: "2026-10-20T20:00:00.000Z",
  knownAt: "2026-10-20T20:00:00.000Z",
});
function fixture() {
  const base = fixtureCostOfCapitalReadings().betas!;
  return {
    syntheticRating: "Ba1/BB+",
    knowledge,
    legalEntityId: DEMO_VALUATION_INPUT.subject.legalEntityId,
    cik: "0000000001",
    declarations: [],
    reading: {
      release: { ...base.release, datasetId: FAILURE_RATES_DATASET },
      rows: [{ key: "bb", label: "BB", values: { year_10: "0.1" } }],
    },
  };
}
describe("failure risk selection", () => {
  it.each([
    ["Aaa/AAA", "aaa"],
    ["Aa2/AA", "aa"],
    ["A1/A+", "a"],
    ["A3/A-", "a"],
    ["Baa2/BBB", "bbb"],
    ["Ba1/BB+", "bb"],
    ["B3/B-", "b"],
    ["Caa/CCC", "ccc-c"],
    ["Ca2/CC", "ccc-c"],
    ["C2/C", "ccc-c"],
    ["D2/D", null],
    ["unknown", null],
  ])("maps %s to %s without inventing notches", (rating, bucket) =>
    expect(failureRatingBucket(rating!)).toBe(bucket),
  );
  it("takes the ten-year probability with its exact release and observation time", () => {
    const risk = buildFailureRisk(fixture());
    expect(risk).toMatchObject({
      basis: "rating_table",
      horizonYears: 10,
      syntheticRating: "Ba1/BB+",
      parameter: {
        datasetId: FAILURE_RATES_DATASET,
        rowKey: "bb",
        field: "year_10",
        value: "0.1",
      },
    });
    expect(failureProbability(risk)).toBe("0.1");
    expect(failureRiskMismatches(risk, fixture())).toEqual([]);
  });
  it("refuses a future release for public or system knowledge", () => {
    const input = fixture();
    input.reading.release.availableAt = "2026-10-21T00:00:00.000Z";
    expect(buildFailureRisk(input)).toMatchObject({
      basis: "missing",
      reason: "failure_rate_release_missing",
    });
    input.reading.release.availableAt = "2026-10-02T17:30:00.000Z";
    input.reading.release.recordedAt = "2026-10-21T00:00:00.000Z";
    expect(
      buildFailureRisk({
        ...input,
        knowledge: pointInTimeQuerySchema.parse({
          ...knowledge,
          knowledgeBasis: "system_recorded",
        }),
      }),
    ).toMatchObject({ basis: "missing" });
  });
  it("lets latest-restated use the open release, while the effective cutoff still applies", () => {
    expect(
      buildFailureRisk({
        ...fixture(),
        knowledge: pointInTimeQuerySchema.parse({
          ...knowledge,
          knownAt: null,
          revisionPolicy: "latest_restated",
        }),
      }),
    ).toMatchObject({ basis: "rating_table" });
  });
  it("names a missing rate, never presuming zero", () => {
    const input = fixture();
    expect(buildFailureRisk({ ...input, reading: null })).toMatchObject({
      basis: "missing",
    });
    expect(buildFailureRisk({ ...input, syntheticRating: null })).toMatchObject(
      { basis: "missing", reason: "synthetic_rating_missing" },
    );
    input.reading.rows[0]!.values.year_10 = "NaN";
    expect(buildFailureRisk(input)).toMatchObject({ basis: "missing" });
  });
  it("does not turn a synthetic D rating into a certain observed default", () => {
    expect(
      buildFailureRisk({
        ...fixture(),
        syntheticRating: "D2/D",
        reading: null,
      }),
    ).toMatchObject({ basis: "missing", reason: "synthetic_rating_unmapped" });
  });
  it("honors only the owner's known declaration for this CIK and subject", () => {
    const input = fixture();
    const declaration = {
      cik: input.cik,
      probability: "0.2",
      rationale: "Owner assessment.",
      declaredAt: "2026-10-19T00:00:00.000Z",
    };
    const risk = buildFailureRisk({ ...input, declarations: [declaration] });
    expect(risk).toMatchObject({
      basis: "owner_declaration",
      legalEntityId: input.legalEntityId,
    });
    expect(failureProbability(risk)).toBe("0.2");
    expect(
      buildFailureRisk({
        ...input,
        declarations: [{ ...declaration, cik: "0000000002" }],
      }),
    ).toMatchObject({ basis: "rating_table" });
    expect(
      buildFailureRisk({
        ...input,
        declarations: [
          { ...declaration, declaredAt: "2026-10-21T00:00:00.000Z" },
        ],
      }),
    ).toMatchObject({ basis: "rating_table" });
    expect(
      failureRiskMismatches(risk, {
        ...input,
        legalEntityId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toContain("failureRisk.legalEntityId");
  });
  it("names conflicting owner declarations at the same instant", () => {
    const input = fixture();
    const declaration = {
      cik: input.cik,
      probability: "0.2",
      rationale: "Owner decision.",
      declaredAt: "2026-10-19T00:00:00.000Z",
    };
    expect(
      buildFailureRisk({
        ...input,
        declarations: [declaration, { ...declaration, probability: "0.3" }],
      }),
    ).toMatchObject({ basis: "missing", reason: "owner_declaration_conflict" });
  });
  it("rejects a changed row, rating, cutoff or out-of-range rate at replay", () => {
    const risk = buildFailureRisk(fixture());
    if (risk.basis !== "rating_table") throw new Error("Expected table");
    expect(
      failureRiskMismatches(
        { ...risk, parameter: { ...risk.parameter, rowKey: "b" } },
        fixture(),
      ),
    ).toContain("failureRisk.parameter.rowKey");
    expect(
      failureRiskMismatches({ ...risk, syntheticRating: "Aaa/AAA" }, fixture()),
    ).toContain("failureRisk.syntheticRating");
    expect(
      failureRiskMismatches(
        {
          ...risk,
          parameter: {
            ...risk.parameter,
            availableAt: "2026-10-21T00:00:00.000Z",
          },
        },
        fixture(),
      ),
    ).toContain("failureRisk.parameter.availableAt");
    expect(
      failureRiskMismatches(
        {
          ...risk,
          parameter: {
            ...risk.parameter,
            recordedAt: "2026-10-21T00:00:00.000Z",
          },
        },
        {
          ...fixture(),
          knowledge: pointInTimeQuerySchema.parse({
            ...knowledge,
            knowledgeBasis: "system_recorded",
          }),
        },
      ),
    ).toContain("failureRisk.parameter.availableAt");
    for (const value of ["-0.1", "1.1"]) {
      expect(() =>
        failureProbability({
          ...risk,
          parameter: { ...risk.parameter, value },
        }),
      ).toThrow();
    }
    expect(() =>
      failureProbability({
        version: "failure-risk-1.0.0",
        basis: "missing",
        reason: "missing",
      } as FailureRisk),
    ).toThrow();
  });
});
