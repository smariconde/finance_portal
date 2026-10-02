import { describe, expect, it } from "vitest";

import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";

import type { FundamentalRow } from "../domain/annual-fundamentals";
import {
  assessCompany,
  fcffPreflight,
  type CompanyAssessmentDependencies,
} from "./assess-company";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-10-02T12:00:00.000Z";
let sequence = 0;

function query(at: string) {
  return {
    effectiveAt: at,
    knownAt: at,
    revisionPolicy: "as_known" as const,
    adjustmentPolicy: "as_known" as const,
    sourcePolicyVersion: "source-policy-1.0.0",
  };
}

function sic(code: string): SubjectClassification {
  return {
    classificationAssignmentId: "22222222-2222-4222-8222-222222222222",
    subjectType: "legal_entity",
    subjectId: SUBJECT,
    taxonomyId: "sec-sic",
    taxonomyVersion: "sec-submissions-1.0.0",
    code,
    label: `${code} Fixture`,
    validFrom: OBSERVED_AT,
    validTo: null,
    availableAt: OBSERVED_AT,
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: "submissions/CIK0000000042.json",
    contentHash: "c".repeat(64),
    recordedAt: OBSERVED_AT,
  };
}

function annual(concept: string, end: string, value: string): FundamentalRow {
  sequence += 1;
  const year = Number.parseInt(end.slice(0, 4), 10);

  return {
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    subjectId: SUBJECT,
    concept: `us-gaap:${concept}`,
    periodType: concept === "StockholdersEquity" ? "instant" : "annual",
    asOf: end,
    periodStart: concept === "StockholdersEquity" ? null : `${year}-01-01`,
    unit:
      concept === "WeightedAverageNumberOfDilutedSharesOutstanding"
        ? "shares"
        : "USD",
    currency:
      concept === "WeightedAverageNumberOfDilutedSharesOutstanding"
        ? null
        : "USD",
    value,
    availableAt: `${year + 1}-02-01T21:00:00.000Z`,
    recordedAt: `${year + 1}-02-02T00:00:00.000Z`,
    sourceDocumentId: `0000000042-${year}-000001`,
  };
}

/** Una no financiera madura: cuatro ejercicios sanos con crecimiento moderado. */
function matureRows(): FundamentalRow[] {
  return ["2022", "2023", "2024", "2025"].flatMap((year, index) => {
    const end = `${year}-12-31`;
    return [
      annual("Revenues", end, String(100 + index * 5)),
      annual("OperatingIncomeLoss", end, "20"),
      annual("IncomeTaxExpenseBenefit", end, "4"),
      annual("WeightedAverageNumberOfDilutedSharesOutstanding", end, "10"),
      annual("StockholdersEquity", end, "60"),
    ];
  });
}

function dependencies(
  assertions: readonly SubjectClassification[],
  rows: readonly FundamentalRow[],
  anchors: readonly string[] = ["2025-12-31"],
): CompanyAssessmentDependencies {
  return {
    loadSicAssertions: async () => assertions,
    readFundamentals: async () => rows,
    fiscalYearAnchors: async () => anchors,
  };
}

describe("assessCompany", () => {
  it("selects FCFF for a mature non-financial with every exclusion ruled out", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
      },
      dependencies([sic("3571")], matureRows()),
    );

    expect(assessment.sic).toMatchObject({ code: "3571" });
    expect(assessment.fcffPreflight).toEqual({ complete: true, missing: [] });
    expect(assessment.selection).toMatchObject({
      status: "selected",
      assetProfile: "non_financial_mature",
      recommendedMethod: "fcff_base",
      confidence: "high",
    });
  });

  it("does not see a SIC observed after the cutoff", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-06-30T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
      },
      dependencies([sic("3571")], matureRows()),
    );

    expect(assessment.sic).toBeNull();
    expect(assessment.selection).toMatchObject({
      assetProfile: null,
      unsupportedReasons: ["missing_classification_evidence"],
    });
  });

  it("names missing fundamentals instead of assuming a profile", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
      },
      dependencies([sic("3571")], [], []),
    );

    expect(assessment.fundamentals.series).toBeNull();
    expect(assessment.fcffPreflight).toEqual({
      complete: false,
      missing: ["annual_fundamentals"],
    });
    expect(assessment.selection.requiredInputs).toEqual([
      "profile_evidence.distressed",
      "profile_evidence.loss_making",
      "profile_evidence.high_growth",
    ]);
  });

  it("recognizes a bank from its SIC alone", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
      },
      dependencies([sic("6021")], []),
    );

    expect(assessment.selection).toMatchObject({
      assetProfile: "bank",
      unsupportedReasons: ["method_not_implemented"],
    });
  });

  it("ignores SIC assertions of another subject", async () => {
    const foreign = {
      ...sic("6021"),
      subjectId: "33333333-3333-4333-8333-333333333333",
    };
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
      },
      dependencies([foreign], matureRows()),
    );

    expect(assessment.sic).toBeNull();
  });
});

describe("fcffPreflight", () => {
  it("names each structural input that the latest year lacks", () => {
    expect(
      fcffPreflight({
        version: "annual-fundamentals-1.0.0",
        fiscalYears: [{ fiscalYearEnd: "2025-12-31", items: {} }],
      }),
    ).toEqual({
      complete: false,
      missing: ["revenue", "operating_income", "income_tax", "diluted_shares"],
    });
  });
});
