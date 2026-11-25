import { describe, expect, it } from "vitest";

import type { BusinessLine } from "@/modules/fundamentals/domain/sec-xbrl-business-lines";

import { fixtureCostOfCapitalReadings } from "../infrastructure/fixture-cost-of-capital-readings";
import {
  businessExposureMismatches,
  resolveBusinessExposure,
  type BusinessMixReading,
} from "./business-exposure";
import {
  BUSINESS_MIX_WEIGHTS_VERSION,
  businessMixDeclarationSchema,
  revenueByIndustry,
  type BusinessMixLineRecord,
} from "./business-mix";
import {
  judgeBusinessMix,
  type BusinessMixInput,
  type BusinessMixOutput,
} from "./business-mix-task";
import {
  buildCostOfCapital,
  deriveCostOfCapital,
  EV_SALES_DATASET,
  type ReferenceReading,
} from "./cost-of-capital";
import {
  businessMixDecisionOfDeclaration,
  businessMixReadingOf,
  qualitativeDecisionMismatches,
  type BusinessMixDecision,
} from "./qualitative-decisions";

const ITEM_1 =
  "Google Services generates revenues primarily from performance and brand advertising. Google Cloud provides enterprise infrastructure, platform services and collaboration tools to businesses.";

const LINES: readonly BusinessLine[] = [
  {
    lineId: "L1",
    axis: "StatementBusinessSegmentsAxis",
    member: "GoogleServicesMember",
    concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    amount: "300",
  },
  {
    lineId: "L2",
    axis: "StatementBusinessSegmentsAxis",
    member: "GoogleCloudMember",
    concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    amount: "100",
  },
  {
    lineId: "L3",
    axis: "ProductOrServiceAxis",
    member: "AdvertisingMember",
    concept: "us-gaap:Revenues",
    amount: "260",
  },
  {
    lineId: "L4",
    axis: "ProductOrServiceAxis",
    member: "ProductMember",
    concept: "us-gaap:Revenues",
    amount: "400",
  },
];

const INPUT: BusinessMixInput = {
  companyName: "Fixture Holdings",
  industryKeys: ["advertising", "software-system-and-application"],
  lines: LINES,
  evidence: [
    {
      evidenceId: "E1",
      sourceId: "sec-edgar",
      section: "item_1_business",
      text: ITEM_1,
    },
    {
      evidenceId: "E2",
      sourceId: "sec-edgar",
      section: "xbrl_business_lines",
      text: "L1 | StatementBusinessSegmentsAxis | GoogleServicesMember | 300",
    },
  ],
  expectedRevenue: "401",
};

function proposal(
  overrides: Partial<BusinessMixOutput> = {},
): BusinessMixOutput {
  return {
    decision: "proposed",
    axis: "StatementBusinessSegmentsAxis",
    lines: [
      {
        lineId: "L1",
        industryKey: "advertising",
        quote:
          "Google Services generates revenues primarily from performance and brand advertising.",
        evidenceId: "E1",
      },
      {
        lineId: "L2",
        industryKey: "software-system-and-application",
        quote:
          "Google Cloud provides enterprise infrastructure, platform services",
        evidenceId: "E1",
      },
    ],
    confidence: "high",
    rationale: "Two businesses: advertising and cloud.",
    abstainReason: null,
    ...overrides,
  };
}

describe("business-mix-policy-1.0.0", () => {
  it("accepts offered lines of one axis that add up to revenue, each quoted", () => {
    expect(judgeBusinessMix(proposal(), INPUT)).toEqual({ verdict: "accept" });
  });

  it.each([
    ["a line that was not offered", { lineId: "L9" }, "line_not_offered"],
    ["a line of the other axis", { lineId: "L3" }, "lines_from_another_axis"],
    [
      "a key outside the release",
      { industryKey: "software-internet" },
      "key_not_in_release",
    ],
    [
      "a quote that is not in Item 1",
      { quote: "Google Cloud is the largest business in the world." },
      "quote_not_in_evidence",
    ],
    [
      "a quote from the XBRL lines instead of Item 1",
      {
        quote: "L1 | StatementBusinessSegmentsAxis | GoogleServicesMember",
        evidenceId: "E2",
      },
      "quote_not_in_evidence",
    ],
    [
      "an unknown evidence block",
      { evidenceId: "E7" },
      "unknown_evidence_cited",
    ],
  ])("rejects %s", (_name, change, code) => {
    const output = proposal();
    const lines = [{ ...output.lines[0]!, ...change }, output.lines[1]!];

    expect(judgeBusinessMix({ ...output, lines }, INPUT)).toEqual({
      verdict: "reject",
      code,
    });
  });

  it("rejects a line named twice", () => {
    const output = proposal();

    expect(
      judgeBusinessMix(
        { ...output, lines: [output.lines[0]!, output.lines[0]!] },
        INPUT,
      ),
    ).toEqual({ verdict: "reject", code: "line_repeated" });
  });

  it("rejects lines that leave a business out or overlap an aggregate", () => {
    const output = proposal();

    expect(
      judgeBusinessMix({ ...output, lines: [output.lines[0]!] }, INPUT),
    ).toEqual({ verdict: "reject", code: "lines_do_not_sum_to_revenue" });

    const aggregate = proposal({
      axis: "ProductOrServiceAxis",
      lines: [
        { ...output.lines[0]!, lineId: "L3" },
        { ...output.lines[1]!, lineId: "L4" },
      ],
    });
    expect(judgeBusinessMix(aggregate, INPUT)).toEqual({
      verdict: "reject",
      code: "lines_do_not_sum_to_revenue",
    });
  });

  it("treats low confidence as an abstention and passes an abstention through", () => {
    expect(judgeBusinessMix(proposal({ confidence: "low" }), INPUT)).toEqual({
      verdict: "abstain",
      reason: "low_confidence",
    });
    expect(
      judgeBusinessMix(
        proposal({
          decision: "abstain",
          axis: null,
          lines: [],
          abstainReason: "insufficient_evidence",
        }),
        INPUT,
      ),
    ).toEqual({ verdict: "abstain", reason: "insufficient_evidence" });
  });
});

function withBusinessRows(): {
  betas: ReferenceReading;
  evToSales: ReferenceReading;
} {
  const readings = fixtureCostOfCapitalReadings();
  const betas: ReferenceReading = {
    release: readings.betas.release,
    rows: [
      ...readings.betas.rows,
      {
        key: "advertising",
        label: "Advertising",
        values: { unlevered_beta_cash_corrected: "1.0", debt_to_equity: "0.4" },
      },
      {
        key: "software-system-and-application",
        label: "Software",
        values: {
          unlevered_beta_cash_corrected: "1.5",
          debt_to_equity: "0.05",
        },
      },
    ],
  };
  const evToSales: ReferenceReading = {
    release: {
      ...readings.betas.release,
      datasetId: EV_SALES_DATASET,
      releaseId: "00000000-0000-4000-8000-0000000000c7",
    },
    rows: [
      { key: "advertising", label: "Advertising", values: { ev_sales: "2" } },
      {
        key: "software-system-and-application",
        label: "Software",
        values: { ev_sales: "4" },
      },
      {
        key: "computers-peripherals",
        label: "Computers",
        values: { ev_sales: "NA" },
      },
    ],
  };
  return { betas, evToSales };
}

const MIX: BusinessMixReading = {
  source: "ai_proposal",
  proposalId: "00000000-0000-4000-8000-00000000a001",
  weightsVersion: BUSINESS_MIX_WEIGHTS_VERSION,
  businesses: [
    { industryKey: "advertising", revenue: "300", declaredWeight: null },
    {
      industryKey: "software-system-and-application",
      revenue: "100",
      declaredWeight: null,
    },
  ],
};

describe("business-mix-weights-1.0.0", () => {
  it("weights each industry by its revenue times its EV/Sales", () => {
    const { betas, evToSales } = withBusinessRows();
    const { exposure, missing } = resolveBusinessExposure(
      MIX,
      betas,
      evToSales,
    );

    expect(missing).toEqual([]);
    // 300 × 2 = 600 y 100 × 4 = 400: el software pesa 40 % con un cuarto de
    // las ventas.
    expect(
      exposure?.businesses.map((item) => [item.estimatedValue, item.weight]),
    ).toEqual([
      ["600", "0.6"],
      ["400", "0.4"],
    ]);
    expect(exposure?.unleveredBeta).toBe("1.2");
    expect(exposure?.debtToEquity).toBe("0.26");
    expect(businessExposureMismatches(exposure!)).toEqual([]);
  });

  it("names an industry without a positive EV/Sales or without a beta", () => {
    const { betas, evToSales } = withBusinessRows();
    const mix: BusinessMixReading = {
      ...MIX,
      businesses: [
        ...MIX.businesses,
        {
          industryKey: "computers-peripherals",
          revenue: "5",
          declaredWeight: null,
        },
        { industryKey: "steel", revenue: "5", declaredWeight: null },
      ],
    };

    expect(resolveBusinessExposure(mix, betas, evToSales)).toEqual({
      exposure: null,
      missing: [
        "business_mix_ev_to_sales.computers-peripherals",
        "business_mix_beta.steel",
      ],
    });
    expect(resolveBusinessExposure(MIX, betas, null).missing).toEqual([
      "business_mix_ev_to_sales",
    ]);
  });

  it("uses an owner's declared weights without EV/Sales", () => {
    const { betas } = withBusinessRows();
    const { exposure } = resolveBusinessExposure(
      {
        source: "owner_declaration",
        proposalId: null,
        weightsVersion: BUSINESS_MIX_WEIGHTS_VERSION,
        businesses: [
          { industryKey: "advertising", revenue: null, declaredWeight: "0.5" },
          {
            industryKey: "software-system-and-application",
            revenue: null,
            declaredWeight: "0.5",
          },
        ],
      },
      betas,
      null,
    );

    expect(exposure?.unleveredBeta).toBe("1.25");
    expect(exposure?.evToSalesReleaseId).toBeNull();
  });

  it("finds a weight or a combined beta written by hand", () => {
    const { betas, evToSales } = withBusinessRows();
    const exposure = resolveBusinessExposure(MIX, betas, evToSales).exposure!;

    expect(
      businessExposureMismatches({
        ...exposure,
        businesses: [
          { ...exposure.businesses[0]!, weight: "0.5" },
          { ...exposure.businesses[1]!, weight: "0.5" },
        ],
      }),
    ).toEqual([
      "costOfCapital.businessExposure.businesses.0.weight",
      "costOfCapital.businessExposure.businesses.1.weight",
      "costOfCapital.businessExposure.unleveredBeta",
      "costOfCapital.businessExposure.debtToEquity",
    ]);
    expect(
      businessExposureMismatches({ ...exposure, unleveredBeta: "0.9" }),
    ).toEqual(["costOfCapital.businessExposure.unleveredBeta"]);
  });
});

function coverage() {
  return {
    value: "29.06",
    fiscalYearEnd: "2025-09-27",
    fromLatestFiscalYear: true,
    availableAt: "2025-10-31T00:00:00.000Z",
  };
}

function costOfCapital(businessMix: BusinessMixReading | null) {
  const { betas, evToSales } = withBusinessRows();
  const result = buildCostOfCapital({
    currency: "USD",
    industryKey: "computers-peripherals",
    listingCountry: "US",
    ...fixtureCostOfCapitalReadings(),
    betas,
    evToSales,
    coverage: coverage(),
    businessMix,
  });
  if (result.status !== "computed") throw new Error(result.missing.join());
  return result.costOfCapital;
}

describe("cost-of-capital-1.2.0", () => {
  it("relevers the business-mix beta to the business-mix structure", () => {
    const built = costOfCapital(MIX);

    expect(built.version).toBe("cost-of-capital-1.2.0");
    // βL = 1,2 × (1 + 0,75 × 0,26).
    expect(built.derived.leveredBeta).toBe("1.434");
    expect(built.declarations).toContain("beta_by_business_mix");
    expect(built.declarations).toContain("target_structure_business_mix");
    expect(built.declarations).not.toContain("industry_beta_us");
    // Los nueve parámetros siguen siendo los de la industria propia.
    expect(
      built.parameters.find((item) => item.name === "unlevered_beta")?.value,
    ).toBe("1.32");
    expect(
      deriveCostOfCapital(
        built.parameters,
        built.derived.syntheticRating,
        built.operationsExposure ?? null,
        built.businessExposure ?? null,
      ),
    ).toEqual(built.derived);
  });

  it("stays 1.1.0 byte for byte without a mix", () => {
    const built = costOfCapital(null);

    expect(built.version).toBe("cost-of-capital-1.1.0");
    expect(built).not.toHaveProperty("businessExposure");
    expect(built.declarations).toContain("industry_beta_us");
    expect(built.derived.leveredBeta).toBe("1.365738");
  });
});

const LINE_RECORDS: BusinessMixLineRecord[] = [
  {
    ordinal: 1,
    lineId: "L1",
    axis: "StatementBusinessSegmentsAxis",
    member: "GoogleServicesMember",
    concept: "us-gaap:Revenues",
    amount: "300",
    industryKey: "advertising",
    quote: "Google Services generates revenues",
    evidenceId: "E1",
  },
  {
    ordinal: 2,
    lineId: "L2",
    axis: "StatementBusinessSegmentsAxis",
    member: "GoogleCloudMember",
    concept: "us-gaap:Revenues",
    amount: "100",
    industryKey: "software-system-and-application",
    quote: "Google Cloud provides enterprise infrastructure",
    evidenceId: "E1",
  },
];

function aiDecision(lines = LINE_RECORDS): BusinessMixDecision {
  return {
    source: "ai_proposal",
    weightsVersion: BUSINESS_MIX_WEIGHTS_VERSION,
    proposal: {
      proposalId: MIX.proposalId!,
      taskVersion: "business-mix-1.0.0",
      promptVersion: "business-mix-prompt-1.0.0",
      policyVersion: "business-mix-policy-1.0.0",
      ladderVersion: "ai-model-ladder-1.1.0",
      linesVersion: "sec-xbrl-business-lines-1.0.0",
      sectionsVersion: "sec-10k-sections-1.0.0",
      accessionNumber: "0001652044-26-000010",
      fiscalYearEnd: "2025-12-31",
      betasReleaseId: "00000000-0000-4000-8000-0000000000b1",
      axis: "StatementBusinessSegmentsAxis",
      expectedRevenue: "401",
      confidence: "high",
      respondedModel: "fixture/model",
      acceptedRung: 1,
      proposedAt: "2026-11-24T12:00:00.000Z",
    },
    lines,
    evidence: [
      {
        evidenceId: "E1",
        sourceId: "sec-edgar",
        section: "item_1_business",
        documentUrl: "https://www.sec.gov/Archives/edgar/data/1/x/doc.htm",
        accessionNumber: "0001652044-26-000010",
        documentAcceptedAt: "2026-02-04T21:00:00.000Z",
        sha256: "a".repeat(64),
        byteLength: 10,
        truncated: false,
      },
    ],
  };
}

describe("qualitative-decisions-1.2.0: business mix", () => {
  const decisions = (businessMix: BusinessMixDecision | undefined) => ({
    version: "qualitative-decisions-1.2.0" as const,
    industry: {
      basis: "sic" as const,
      mappingVersion: "sic-damodaran-industry-1.1.0",
      industryKey: "computers-peripherals",
      sic: "3571",
      candidates: ["computers-peripherals"],
    },
    operationsMix: null,
    ...(businessMix === undefined ? {} : { businessMix }),
  });
  const businessOnly = (mismatches: string[]) =>
    mismatches.filter((path) => path.includes("business"));

  it("derives the revenue by industry the cost of capital weighted", () => {
    expect(businessMixReadingOf(aiDecision())).toEqual(MIX);
    expect(
      businessOnly(
        qualitativeDecisionMismatches(
          decisions(aiDecision()),
          costOfCapital(MIX),
        ),
      ),
    ).toEqual([]);
  });

  it("joins lines of one industry and drops a single-industry answer", () => {
    expect(
      revenueByIndustry([
        { industryKey: "retail-general", amount: "10" },
        { industryKey: "advertising", amount: "1" },
        { industryKey: "retail-general", amount: "5" },
      ]),
    ).toEqual([
      { industryKey: "retail-general", revenue: "15" },
      { industryKey: "advertising", revenue: "1" },
    ]);

    const single = aiDecision(
      LINE_RECORDS.map((line) => ({ ...line, industryKey: "advertising" })),
    );
    expect(businessMixReadingOf(single)).toBeNull();
    expect(
      businessOnly(
        qualitativeDecisionMismatches(decisions(single), costOfCapital(null)),
      ),
    ).toEqual([]);
  });

  it("rejects a mix the decision does not explain, or a decision the run ignored", () => {
    expect(
      businessOnly(
        qualitativeDecisionMismatches(decisions(undefined), costOfCapital(MIX)),
      ),
    ).toEqual([
      "qualitativeDecisions.businessMix",
      "costOfCapital.businessExposure",
    ]);
    expect(
      businessOnly(
        qualitativeDecisionMismatches(
          decisions(aiDecision()),
          costOfCapital(null),
        ),
      ),
    ).toEqual([
      "qualitativeDecisions.businessMix",
      "costOfCapital.businessExposure",
    ]);

    const other = aiDecision([
      { ...LINE_RECORDS[0]!, amount: "200" },
      LINE_RECORDS[1]!,
    ]);
    expect(
      businessOnly(
        qualitativeDecisionMismatches(decisions(other), costOfCapital(MIX)),
      ),
    ).toEqual(["costOfCapital.businessExposure"]);
  });

  it("takes an owner's declaration as given, with weights that add up to one", () => {
    const declaration = {
      cik: "0001652044",
      businesses: [
        { industryKey: "advertising", weight: "0.7" },
        { industryKey: "software-system-and-application", weight: "0.3" },
      ],
      rationale: "Search and YouTube are advertising; Cloud is software.",
      declaredOn: "2026-11-24",
    };

    expect(
      businessMixReadingOf(businessMixDecisionOfDeclaration(declaration))
        ?.businesses,
    ).toEqual([
      { industryKey: "advertising", revenue: null, declaredWeight: "0.7" },
      {
        industryKey: "software-system-and-application",
        revenue: null,
        declaredWeight: "0.3",
      },
    ]);
    expect(
      businessMixDeclarationSchema.safeParse({
        ...declaration,
        businesses: [
          { industryKey: "advertising", weight: "0.7" },
          { industryKey: "advertising", weight: "0.2" },
        ],
      }).success,
    ).toBe(false);
  });
});
