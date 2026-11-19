import { describe, expect, it } from "vitest";

import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";

import { readXbrlInstance } from "@/modules/fundamentals/domain/sec-xbrl-instance";

import type { FundamentalRow } from "../domain/annual-fundamentals";
import type { CaptiveFinanceFiling } from "../domain/captive-finance";
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

  describe("zero-debt evidence", () => {
    const instant = (concept: string, end: string, value: string) => ({
      ...annual(concept, end, value),
      periodType: "instant",
      periodStart: null,
    });
    /** Cinco ejercicios sin préstamos ni intereses (la forma de Intuitive). */
    const debtFree = (extra: (end: string) => FundamentalRow[] = () => []) =>
      ["2021", "2022", "2023", "2024", "2025"].flatMap((year, index) => {
        const end = `${year}-12-31`;
        return [
          annual("Revenues", end, String(100 + index * 5)),
          annual("OperatingIncomeLoss", end, "20"),
          annual(
            "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
            end,
            "21",
          ),
          annual("IncomeTaxExpenseBenefit", end, "4"),
          annual("WeightedAverageNumberOfDilutedSharesOutstanding", end, "10"),
          annual("StockholdersEquity", end, "60"),
          instant("CashAndCashEquivalentsAtCarryingValue", end, "15"),
          ...extra(end),
        ];
      });
    const request = {
      legalEntityId: SUBJECT,
      query: query("2026-10-03T00:00:00.000Z"),
      fundamentalsSourceId: "sec-edgar",
      cik: "0000000042",
      industryDeclarations: [],
      listingCountry: "US",
    };

    it("values debt at zero and rates the coverage at the top band, both named", async () => {
      const assessment = await assessCompany(
        request,
        dependencies([sic("3571")], debtFree()),
      );

      expect(assessment.zeroDebt?.status).toBe("met");
      expect(assessment.normalization?.debt).toMatchObject({
        status: "zero_with_evidence",
        total: "0",
      });
      expect(
        assessment.normalization?.facts.zeroDebtEvidence?.fiscalYears,
      ).toHaveLength(5);
      expect(assessment.normalization?.investedCapital).toMatchObject({
        status: "resolved",
        debt: "0",
      });
      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: {
          coverage: { interestBasis: "no_interest_expense" },
          declarations: expect.arrayContaining([
            "coverage_no_interest_expense",
          ]),
        },
      });
      // Sin deuda publicada, la completitud de caja y deuda no se cumple: el
      // rigor no llega a `full`.
      expect(assessment.rigor.degradedBy).toContain("cash_and_debt");
    });

    it("does not call D.R. Horton debt-free: the maturity schedule is debt", async () => {
      const assessment = await assessCompany(
        request,
        dependencies(
          [sic("3571")],
          debtFree((end) => [
            instant(
              "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
              end,
              "2400",
            ),
          ]),
        ),
      );

      expect(assessment.zeroDebt).toEqual({
        status: "not_met",
        reason: "borrowing_reported",
      });
      expect(assessment.normalization?.debt).toMatchObject({
        status: "unresolved",
        reason: "no_recipe",
      });
      expect(
        "zeroDebtEvidence" in (assessment.normalization?.facts ?? {}),
      ).toBe(false);
      expect(assessment.costOfCapital).toMatchObject({
        status: "unsupported",
        missing: expect.arrayContaining(["interest_coverage"]),
      });
    });
  });

  describe("operating loss with net cash (net-cash-coverage-1.0.0)", () => {
    const instant = (concept: string, end: string, value: string) => ({
      ...annual(concept, end, value),
      periodType: "instant",
      periodStart: null,
    });
    /** CRWD's shape: GAAP operating losses, notes, more cash than debt. */
    const rows = (ocf: string, cash: string) =>
      ["2022", "2023", "2024", "2025"].flatMap((year, index) => {
        const end = `${year}-12-31`;
        return [
          annual("Revenues", end, String(100 + index * 30)),
          annual("OperatingIncomeLoss", end, "-5"),
          annual("InterestExpense", end, "1"),
          annual("IncomeTaxExpenseBenefit", end, "1"),
          annual("WeightedAverageNumberOfDilutedSharesOutstanding", end, "10"),
          annual("StockholdersEquity", end, "60"),
          annual("NetCashProvidedByUsedInOperatingActivities", end, ocf),
          instant("CashAndCashEquivalentsAtCarryingValue", end, cash),
          instant("LongTermDebtNoncurrent", end, "30"),
        ];
      });
    const request = {
      legalEntityId: SUBJECT,
      query: query("2026-10-03T00:00:00.000Z"),
      fundamentalsSourceId: "sec-edgar",
      cik: "0000000042",
      industryDeclarations: [],
      listingCountry: "US",
    };

    it("rates the coverage at the top band with the evidence frozen", async () => {
      const assessment = await assessCompany(
        request,
        dependencies([sic("3571")], rows("25", "80")),
      );

      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: {
          coverage: {
            interestBasis: "net_cash_operating_loss",
            fiscalYearEnd: "2025-12-31",
            netCash: { version: "net-cash-coverage-1.0.0" },
          },
          declarations: expect.arrayContaining([
            "coverage_net_cash_operating_loss",
          ]),
        },
      });
      if (assessment.costOfCapital.status !== "computed") return;
      const { coverage, derived } = assessment.costOfCapital.costOfCapital;
      expect(coverage.value).toBe(coverage.netCash!.coverageFloor.value);
      expect(derived.syntheticRating).not.toMatch(/\/D$/u);
    });

    it("keeps the measured D when the company burns cash, at the worst row", async () => {
      const assessment = await assessCompany(
        request,
        dependencies([sic("3571")], rows("-10", "80")),
      );

      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: { coverage: { value: "-5" } },
      });
      if (assessment.costOfCapital.status !== "computed") return;
      expect(
        assessment.costOfCapital.costOfCapital.coverage,
      ).not.toHaveProperty("netCash");
      expect(
        assessment.costOfCapital.costOfCapital.derived.syntheticRating,
      ).toMatch(/\/D$/u);
      // D maps to the worst row now; this fixture has no failure table, so
      // what is missing is the release, not the row.
      expect(assessment.failureRisk).toMatchObject({
        basis: "missing",
        reason: "failure_rate_release_missing",
      });
    });
  });

  describe("owner-declared rating (declared-rating-1.0.0)", () => {
    const instant = (concept: string, end: string, value: string) => ({
      ...annual(concept, end, value),
      periodType: "instant",
      periodStart: null,
    });
    /** Ford's shape in one line: an operating loss over the interest. */
    const rows = () =>
      ["2022", "2023", "2024", "2025"].flatMap((year, index) => {
        const end = `${year}-12-31`;
        return [
          annual("Revenues", end, String(100 + index * 5)),
          annual("OperatingIncomeLoss", end, index === 3 ? "-9" : "5"),
          annual("InterestExpense", end, "1"),
          annual("IncomeTaxExpenseBenefit", end, "1"),
          annual("WeightedAverageNumberOfDilutedSharesOutstanding", end, "10"),
          annual("StockholdersEquity", end, "60"),
          instant("LongTermDebtNoncurrent", end, "400"),
          instant("LongTermDebtCurrent", end, "50"),
        ];
      });
    const request = (at: string) => ({
      legalEntityId: SUBJECT,
      query: query(at),
      fundamentalsSourceId: "sec-edgar",
      cik: "0000037996",
      industryDeclarations: [],
      listingCountry: "US",
    });

    it("rates at the declared band once the declaration is visible", async () => {
      const assessment = await assessCompany(
        request("2026-11-20T00:00:00.000Z"),
        dependencies([sic("3571")], rows()),
      );

      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: {
          coverage: {
            value: "2.25",
            interestBasis: "owner_declared_rating",
            declaredRating: { declaration: { rating: "Ba1/BB+" } },
          },
          derived: { syntheticRating: "Ba1/BB+" },
          declarations: expect.arrayContaining([
            "coverage_owner_declared_rating",
          ]),
        },
      });
    });

    it("keeps the synthetic D before it was declared", async () => {
      const assessment = await assessCompany(
        request("2026-10-03T00:00:00.000Z"),
        dependencies([sic("3571")], rows()),
      );

      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: { derived: { syntheticRating: "D2/D" } },
      });
    });
  });

  describe("captive finance arm", () => {
    const CAT_CIK = "0000018230";
    const instant = (concept: string, end: string, value: string) => ({
      ...annual(concept, end, value),
      periodType: "instant",
      periodStart: null,
    });
    /** Deuda consolidada sin receta e intereses pagados con la financiera. */
    const rows = () =>
      ["2022", "2023", "2024", "2025"].flatMap((year, index) => {
        const end = `${year}-12-31`;
        return [
          annual("Revenues", end, String(100 + index * 5)),
          annual("OperatingIncomeLoss", end, "20"),
          annual("InterestPaidNet", end, "5"),
          annual("IncomeTaxExpenseBenefit", end, "4"),
          annual("WeightedAverageNumberOfDilutedSharesOutstanding", end, "10"),
          annual("StockholdersEquity", end, "60"),
          instant("LongTermDebtNoncurrent", end, "400"),
          instant("ShortTermBorrowings", end, "50"),
        ];
      });
    const member = (id: string, period: string, local: string) =>
      `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CAT_CIK}</identifier><segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">cat:${local}</xbrldi:explicitMember></segment></entity><period>${period}</period></context>`;
    const read =
      readXbrlInstance(`<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
${member("ind", "<instant>2025-12-31</instant>", "MachineryPowerEnergyMember")}
${member("int", "<startDate>2025-01-01</startDate><endDate>2025-12-31</endDate>", "AllOtherExcludingFinancialProductsMember")}
<us-gaap:LongTermDebtAndCapitalLeaseObligations contextRef="ind" unitRef="usd">30</us-gaap:LongTermDebtAndCapitalLeaseObligations>
<us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent contextRef="ind" unitRef="usd">5</us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent>
<us-gaap:InterestExpenseNonoperating contextRef="int" unitRef="usd">1</us-gaap:InterestExpenseNonoperating>
</xbrl>`);
    if (read.status !== "read") throw new Error(read.reason);
    const filing: CaptiveFinanceFiling = {
      accessionNumber: "0000018230-26-000008",
      acceptedAt: "2026-02-13T21:10:00.000Z",
      reportDate: "2025-12-31",
      instance: read.instance,
    };
    const request = {
      legalEntityId: SUBJECT,
      query: query("2026-10-03T00:00:00.000Z"),
      fundamentalsSourceId: "sec-edgar",
      cik: CAT_CIK,
      industryDeclarations: [],
      listingCountry: "US",
    };

    it("subtracts the industrial debt and rates the industrial coverage", async () => {
      const assessment = await assessCompany(
        { ...request, captiveFinanceFiling: filing },
        dependencies([sic("3571")], rows()),
      );

      expect(assessment.captiveFinance).toMatchObject({ status: "split" });
      expect(assessment.normalization?.debt).toMatchObject({
        status: "resolved",
        recipe: "noncurrent_plus_current_maturities",
        total: "35",
      });
      expect(assessment.normalization?.facts.captiveFinance?.financeArm).toBe(
        "Cat Financial",
      );
      expect(assessment.costOfCapital).toMatchObject({
        status: "computed",
        costOfCapital: {
          coverage: { value: "20", interestBasis: "captive_industrial" },
          declarations: expect.arrayContaining([
            "coverage_interest_industrial_only",
          ]),
        },
      });
    });

    it("never subtracts the consolidated debt without the filing", async () => {
      const assessment = await assessCompany(
        request,
        dependencies([sic("3571")], rows()),
      );

      expect(assessment.captiveFinance).toMatchObject({
        status: "unavailable",
        reason: "filing_unavailable",
      });
      expect("captiveFinance" in (assessment.normalization?.facts ?? {})).toBe(
        false,
      );
      expect(assessment.normalization?.debt).toMatchObject({
        status: "unresolved",
      });
    });

    it("never calls a declared issuer debt-free from its consolidated facts", async () => {
      const debtFree = ["2021", "2022", "2023", "2024", "2025"].flatMap(
        (year, index) => {
          const end = `${year}-12-31`;
          return [
            annual("Revenues", end, String(100 + index * 5)),
            annual("OperatingIncomeLoss", end, "20"),
            annual("IncomeTaxExpenseBenefit", end, "4"),
            annual(
              "WeightedAverageNumberOfDilutedSharesOutstanding",
              end,
              "10",
            ),
            annual("StockholdersEquity", end, "60"),
            instant("CashAndCashEquivalentsAtCarryingValue", end, "15"),
          ];
        },
      );
      const assessment = await assessCompany(
        request,
        dependencies([sic("3571")], debtFree),
      );

      expect(assessment.zeroDebt?.status).toBe("met");
      expect(assessment.normalization?.debt).toMatchObject({
        status: "unresolved",
        reason: "no_recipe",
      });
    });

    it("leaves an undeclared issuer as before", async () => {
      const assessment = await assessCompany(
        { ...request, cik: "0000000042", captiveFinanceFiling: filing },
        dependencies([sic("3571")], rows()),
      );

      expect(assessment.captiveFinance).toBeNull();
      expect(assessment.normalization?.debt).toMatchObject({
        status: "unresolved",
      });
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
