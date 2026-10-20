import { describe, expect, it } from "vitest";

import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";

import type { FundamentalRow } from "../domain/annual-fundamentals";
import { fixtureCostOfCapitalReadings } from "../infrastructure/fixture-cost-of-capital-readings";
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
      annual("InterestExpense", end, "2"),
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
    costOfCapitalReadings: async () => fixtureCostOfCapitalReadings(),
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
        listingCountry: "US",
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
    expect(assessment.costOfCapital.status).toBe("computed");
  });

  it("does not see a SIC observed after the cutoff", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-06-30T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
        cik: "0000000042",
        industryDeclarations: [],
        listingCountry: "US",
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
        listingCountry: "US",
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
      listingCountry: "US",
    };
    const ambiguous = await assessCompany(
      { ...request, industryDeclarations: [] },
      dependencies([sic("6021")], matureRows()),
    );

    expect(ambiguous.industry).toEqual({
      version: "sic-damodaran-industry-1.1.0",
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

  const stored = {
    resolution: {
      resolutionId: "00000000-0000-4000-8000-0000000000a1",
      legalEntityId: SUBJECT,
      cik: "0000000042",
      sic: "6021",
      candidates: ["bank-money-center", "banks-regional"],
      taskVersion: "industry-resolution-1.0.0",
      promptVersion: "industry-resolution-prompt-1.0.0",
      ladderVersion: "ai-model-ladder-1.0.0",
      sectionsVersion: "sec-10k-sections-1.0.0",
      outcome: "resolved" as const,
      industryKey: "banks-regional",
      confidence: "high" as const,
      rationale: "A regional bank in the Midwest.",
      reason: null,
      acceptedRung: 1,
      respondedModel: "fixture/model-a",
      citedEvidenceIds: ["E1"],
      resolvedAt: "2026-10-15T12:00:00.000Z",
      recordedAt: "2026-10-15T12:00:00.000Z",
    },
    evidence: [
      {
        evidenceId: "E1",
        sourceId: "sec-edgar",
        section: "item_1_business" as const,
        documentUrl:
          "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231.htm",
        accessionNumber: "0000000042-26-000001",
        documentAcceptedAt: "2026-02-20T21:00:00.000Z",
        sha256: "a".repeat(64),
        byteLength: 31,
        truncated: false,
        excerpt: "Fixture Bancorp, a regional bank",
      },
    ],
  };

  it("reads a stored AI resolution only once it is visible at the cutoff, without calling a model", async () => {
    const resolvedAt = "2026-10-15T12:00:00.000Z";
    const reading = {
      classification: {
        ...sic("6021"),
        classificationAssignmentId: "00000000-0000-4000-8000-0000000000c1",
        taxonomyId: "damodaran-industry",
        taxonomyVersion: "industry-resolution-1.0.0",
        code: "banks-regional",
        label: "Banks (Regional)",
        validFrom: resolvedAt,
        availableAt: resolvedAt,
        sourceId: "openrouter",
        sourceDocumentId:
          "industry-resolution/00000000-0000-4000-8000-0000000000a1",
      },
      reading: {
        resolutionId: "00000000-0000-4000-8000-0000000000a1",
        industryKey: "banks-regional",
        availableAt: resolvedAt,
        respondedModel: "fixture/model-a",
        evidenceIds: ["E1"],
      },
    };
    const assess = (at: string) =>
      assessCompany(
        {
          legalEntityId: SUBJECT,
          query: query(at),
          fundamentalsSourceId: "sec-edgar",
          cik: "0000000042",
          industryDeclarations: [],
          listingCountry: "US",
        },
        {
          ...dependencies([sic("6021")], matureRows()),
          loadIndustryResolutions: async () => [reading],
          loadIndustryResolution: async (resolutionId) =>
            resolutionId === stored.resolution.resolutionId ? stored : null,
        },
      );

    const before = await assess("2026-10-15T11:59:59.000Z");
    expect(before.industry.status).toBe("ambiguous");
    expect(before.qualitativeDecisions.industry).toBeNull();

    const after = await assess("2026-10-16T00:00:00.000Z");
    expect(after.industry).toMatchObject({
      status: "mapped",
      basis: "ai_resolution",
      industryKey: "banks-regional",
      resolution: { respondedModel: "fixture/model-a", evidenceIds: ["E1"] },
    });
    // Lo que una corrida congela: la resolución con la evidencia resumida.
    expect(after.qualitativeDecisions.industry).toEqual({
      basis: "ai_resolution",
      mappingVersion: "sic-damodaran-industry-1.1.0",
      industryKey: "banks-regional",
      sic: "6021",
      candidates: ["bank-money-center", "banks-regional"],
      resolution: {
        resolutionId: stored.resolution.resolutionId,
        taskVersion: "industry-resolution-1.0.0",
        promptVersion: "industry-resolution-prompt-1.0.0",
        ladderVersion: "ai-model-ladder-1.0.0",
        sectionsVersion: "sec-10k-sections-1.0.0",
        respondedModel: "fixture/model-a",
        acceptedRung: 1,
        confidence: "high",
        rationale: "A regional bank in the Midwest.",
        citedEvidenceIds: ["E1"],
        resolvedAt,
        evidence: [
          {
            evidenceId: "E1",
            sourceId: "sec-edgar",
            section: "item_1_business",
            documentUrl: stored.evidence[0]!.documentUrl,
            accessionNumber: "0000000042-26-000001",
            documentAcceptedAt: "2026-02-20T21:00:00.000Z",
            sha256: "a".repeat(64),
            byteLength: 31,
            truncated: false,
          },
        ],
      },
    });
  });

  it("refuses to freeze an AI industry whose stored resolution is gone", async () => {
    const resolvedAt = "2026-10-15T12:00:00.000Z";

    await expect(
      assessCompany(
        {
          legalEntityId: SUBJECT,
          query: query("2026-10-16T00:00:00.000Z"),
          fundamentalsSourceId: "sec-edgar",
          cik: "0000000042",
          industryDeclarations: [],
          listingCountry: "US",
        },
        {
          ...dependencies([sic("6021")], matureRows()),
          loadIndustryResolutions: async () => [
            {
              classification: {
                ...sic("6021"),
                taxonomyId: "damodaran-industry",
                code: "banks-regional",
                validFrom: resolvedAt,
                availableAt: resolvedAt,
              },
              reading: {
                resolutionId: stored.resolution.resolutionId,
                industryKey: "banks-regional",
                availableAt: resolvedAt,
                respondedModel: "fixture/model-a",
                evidenceIds: ["E1"],
              },
            },
          ],
          loadIndustryResolution: async () => null,
        },
      ),
    ).rejects.toThrow("An AI-resolved industry needs its stored resolution.");
  });

  it("recognizes a bank from its SIC alone", async () => {
    const assessment = await assessCompany(
      {
        legalEntityId: SUBJECT,
        query: query("2026-10-03T00:00:00.000Z"),
        fundamentalsSourceId: "sec-edgar",
        cik: "0000000042",
        industryDeclarations: [],
        listingCountry: "US",
      },
      dependencies([sic("6021")], []),
    );

    expect(assessment.selection).toMatchObject({
      assetProfile: "bank",
      unsupportedReasons: ["missing_required_input"],
    });
    // Un banco se valúa sobre el equity: no recibe un WACC.
    expect(assessment.costOfCapital).toMatchObject({
      status: "unsupported",
      missing: ["financial_profile_uses_cost_of_equity"],
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
        listingCountry: "US",
      },
      dependencies([foreign], matureRows()),
    );

    expect(assessment.sic).toBeNull();
  });
});
