import { describe, expect, it } from "vitest";

import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";

import type { FundamentalRow } from "../domain/annual-fundamentals";
import {
  assessCompany,
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
    industryRelease: async () =>
      new Map([
        ["computers-peripherals", "Computers/Peripherals"],
        ["bank-money-center", "Bank (Money Center)"],
        ["banks-regional", "Banks (Regional)"],
      ]),
  };
}

describe("assessCompany", () => {
  it("selects FCFF for a mature non-financial with every exclusion ruled out", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
        cik: "0000000042",
        industryDeclarations: [],
      },
      dependencies([sic("3571")], matureRows()),
    );

    expect(assessment.sic).toMatchObject({ code: "3571" });
    expect(assessment.completeness.checks[0]).toMatchObject({
      check: "structural_inputs",
      status: "met",
    });
    expect(assessment.selection).toMatchObject({
      status: "selected",
      assetProfile: "non_financial_mature",
      recommendedMethod: "fcff_base",
      confidence: "high",
    });
    // El SIC mapea a una sola industria, así que el rigor llega a `standard`
    // y declara el riesgo país por domicilio: no hay mix geográfico.
    expect(assessment.industry).toMatchObject({
      status: "mapped",
      industryKey: "computers-peripherals",
      basis: "sic",
    });
    expect(assessment.rigor).toMatchObject({
      level: "standard",
      declarations: ["country_risk_by_domicile"],
    });
  });

  it("does not see a SIC observed after the cutoff", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-06-30T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
        cik: "0000000042",
        industryDeclarations: [],
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
        cik: "0000000042",
        industryDeclarations: [],
      },
      dependencies([sic("3571")], [], []),
    );

    expect(assessment.fundamentals.series).toBeNull();
    expect(assessment.completeness.checks[0]).toMatchObject({
      check: "structural_inputs",
      status: "missing",
      missing: ["annual_fundamentals"],
    });
    expect(assessment.selection.requiredInputs).toEqual([
      "profile_evidence.distressed",
      "profile_evidence.loss_making",
      "profile_evidence.high_growth",
    ]);
  });

  it("names an ambiguous industry instead of guessing, until the owner declares it", async () => {
    const request = {
      legalEntityId: SUBJECT,
      query: query("2026-10-03T00:00:00.000Z"),
      fundamentalsSourceId: "sec-edgar",
      cik: "0000000042",
    };
    const ambiguous = await assessCompany(
      { ...request, industryDeclarations: [] },
      dependencies([sic("6021")], matureRows()),
    );

    expect(ambiguous.industry).toEqual({
      version: "sic-damodaran-industry-1.0.0",
      status: "ambiguous",
      sic: "6021",
      candidates: ["bank-money-center", "banks-regional"],
    });

    const declared = await assessCompany(
      {
        ...request,
        industryDeclarations: [
          {
            cik: "0000000042",
            ticker: "FIX",
            industryKey: "banks-regional",
            decidedBy: "owner",
            decidedOn: "2026-10-02",
            rationale:
              "Synthetic regional bank used to prove the declaration path.",
          },
        ],
      },
      dependencies([sic("6021")], matureRows()),
    );

    expect(declared.industry).toMatchObject({
      status: "mapped",
      industryKey: "banks-regional",
      basis: "owner_declaration",
    });
  });

  it("recognizes a bank from its SIC alone", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
        cik: "0000000042",
        industryDeclarations: [],
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
        cik: "0000000042",
        industryDeclarations: [],
      },
      dependencies([foreign], matureRows()),
    );

    expect(assessment.sic).toBeNull();
  });
});
