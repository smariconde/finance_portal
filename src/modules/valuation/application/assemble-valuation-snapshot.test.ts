import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import { SHARES_OUTSTANDING_CONCEPT } from "../domain/employee-equity-claim";
import type { EmployeeEquityDecision } from "../domain/employee-equity-claim";
import {
  assembleValuationSnapshot,
  type ValuationSnapshotRequest,
} from "./assemble-valuation-snapshot";
import type { CompanyAssessment } from "./assess-company";
import type { StoredEmployeeEquity } from "./employee-equity-repository";
import { runValuation } from "./run-valuation";

const demo = DEMO_VALUATION_INPUT;
const KNOWN_AT = "2025-06-01T00:00:00.000Z";
const OBSERVATION = "70000000-0000-4000-8000-000000000001";

function revenue(fiscalYearEnd: string, value: string) {
  return {
    fiscalYearEnd,
    items: {
      revenue: {
        item: "revenue" as const,
        concept: "us-gaap:Revenues",
        value,
        unit: "USD",
        currency: "USD",
        asOf: fiscalYearEnd,
        observationId: OBSERVATION,
        availableAt: demo.baseRevenue.availableAt,
        recordedAt: demo.baseRevenue.availableAt,
        sourceDocumentId: demo.baseRevenue.sourceDocumentId,
      },
    },
  };
}

const SERIES: AnnualFundamentals = {
  version: "annual-fundamentals-1.3.0",
  fiscalYears: [
    revenue("2024-12-31", demo.baseRevenue.value),
    revenue("2023-12-31", "90000000"),
    revenue("2022-12-31", "84000000"),
  ],
} as AnnualFundamentals;

const ASSESSMENT = {
  legalEntityId: demo.subject.legalEntityId,
  query: demo.knowledge,
  fundamentals: { anchor: "2024-12-31", series: SERIES },
  selection: demo.assessment.selection,
  completeness: demo.assessment.completeness,
  rigor: demo.assessment.rigor,
  costOfCapital: { status: "computed", costOfCapital: demo.costOfCapital },
  failureRisk: demo.failureRisk,
  qualitativeDecisions: demo.qualitativeDecisions,
  capitalization: demo.capitalization,
  normalization: demo.normalization,
} as unknown as CompanyAssessment;

const OUTSTANDING: EmployeeEquityDecision["transcription"] =
  demo.employeeEquity.decision.transcription;
const NONE: EmployeeEquityDecision["transcription"] = {
  ...OUTSTANDING,
  optionsStatus: "none_disclosed",
  optionsCount: null,
  optionsCountQuote: null,
  optionsStrike: null,
  optionsStrikeQuote: null,
  optionsLifeBasis: null,
  optionsLife: null,
  optionsLifeQuote: null,
  optionsRanges: [],
};

function stored(
  transcription: EmployeeEquityDecision["transcription"],
): StoredEmployeeEquity {
  const decision = demo.employeeEquity.decision;

  return {
    proposal: {
      proposalId: decision.proposalId,
      legalEntityId: demo.subject.legalEntityId,
      cik: "0000000001",
      accessionNumber: decision.accessionNumber,
      fiscalYearEnd: decision.fiscalYearEnd,
      taskVersion: decision.taskVersion,
      promptVersion: decision.promptVersion,
      policyVersion: decision.policyVersion,
      ladderVersion: "ai-model-ladder-1.1.0",
      extractVersion: decision.extractVersion,
      xbrlOptionsOutstanding: null,
      xbrlWeightedStrike: null,
      outcome: "accepted",
      transcription,
      reason: null,
      acceptedRung: 1,
      respondedModel: decision.respondedModel,
      proposedAt: "2025-05-01T00:00:00.000Z",
      recordedAt: "2025-05-01T00:00:00.000Z",
    },
    evidence: {
      sourceId: "sec-edgar",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/1/x.htm",
      accessionNumber: decision.accessionNumber,
      documentAcceptedAt: "2025-02-01T00:00:00.000Z",
      sha256: decision.evidenceSha256,
      byteLength: 100,
      truncated: false,
      excerpt: "Synthetic note.",
    },
  };
}

function request(
  overrides: Partial<ValuationSnapshotRequest> = {},
): ValuationSnapshotRequest {
  return {
    subject: {
      legalEntityId: demo.subject.legalEntityId,
      securityId: demo.subject.securityId,
      listingId: demo.subject.listingId,
    },
    query: {
      ...demo.knowledge,
      knownAt: KNOWN_AT,
    } as ValuationSnapshotRequest["query"],
    assessment: ASSESSMENT,
    fundamentalsSourceId: "sec-edgar",
    employeeEquity: stored(NONE),
    shareCounts: [
      {
        concept: SHARES_OUTSTANDING_CONCEPT,
        asOf: "2025-04-20",
        availableAt: "2025-04-25T00:00:00.000Z",
        value: "12300000",
        observationId: OBSERVATION,
        sourceDocumentId: "fixtureco-q1",
      },
    ],
    prices: {
      sourceId: "yahoo-finance",
      closes: [
        { marketDate: "2025-05-29", close: "14", currency: "USD" },
        { marketDate: "2025-05-30", close: "14.5", currency: "USD" },
        { marketDate: "2025-06-02", close: "15", currency: "USD" },
      ],
      events: [],
    },
    industryReturns: null,
    ...overrides,
  };
}

/** Una release de `damodaran.eva-us` con la fila de la industria del demo. */
function industryReturns(roc: string | null) {
  return {
    release: {
      releaseId: "00000000-0000-4000-8000-0000000000e2",
      datasetId: "damodaran.eva-us",
      publishedLabel: "January 2026",
      availableAt: "2025-01-10T00:00:00.000Z",
    },
    rows: [
      {
        key: demo.costOfCapital.industryKey,
        label: "Computers/Peripherals",
        values: { roc },
      },
    ],
  } as unknown as ValuationSnapshotRequest["industryReturns"];
}

describe("valuation-snapshot-1.0.0", () => {
  it("assembles a derived fcff_base snapshot that the engine values with every check passing", () => {
    const result = assembleValuationSnapshot(request());

    expect(result.status).toBe("assembled");
    if (result.status !== "assembled") return;

    const { input } = result;

    expect(input.asOf).toBe("2025-05-30");
    expect(input.derivedAssumptions).toMatchObject({
      version: "derived-assumptions-2.0.0",
      industryReturn: null,
    });
    expect(input.derivedAssumptions?.revenueHistory).toHaveLength(3);
    // Sin la fila de la industria, el ROIC terminal es el WACC terminal.
    expect(input.terminal.returnOnCapital).toBe(input.terminal.wacc);
    expect(input.bridge.employeeOptions.status).toBe("declared_absent");
    expect(input.bridge.debt.amount?.value).toBe(
      demo.normalization.debt.status === "resolved"
        ? demo.normalization.debt.total
        : null,
    );
    expect(input.bridge.nonOperatingAssets.rationale).toContain(
      "derived-assumptions-2.0.0",
    );
    expect(input.employeeEquity.sharesOutstanding.value).toBe("12300000");

    const run = runValuation(input, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000fa",
    });

    expect(run.failure).toBeNull();
    expect(run.status).not.toBe("rejected");
    expect(
      run.result?.checks.find(
        (check) => check.id === "assumptions_derived_recomputed",
      )?.status,
    ).toBe("passed");
  });

  it("freezes the industry's ROC and bounds the terminal return with it", () => {
    const result = assembleValuationSnapshot(
      request({ industryReturns: industryReturns("0.12") }),
    );

    expect(result.status).toBe("assembled");
    if (result.status !== "assembled") return;

    const { input } = result;

    expect(
      input.derivedAssumptions?.version === "derived-assumptions-2.0.0" &&
        input.derivedAssumptions.industryReturn,
    ).toMatchObject({
      rowKey: demo.costOfCapital.industryKey,
      value: "0.12",
      releaseId: "00000000-0000-4000-8000-0000000000e2",
    });
    expect(input.terminal.returnOnCapital).toBe("0.12");

    const run = runValuation(input, {
      now: () => "2026-10-21T00:00:00.000Z",
      newValuationRunId: () => "00000000-0000-4000-8000-0000000000fb",
    });

    expect(run.failure).toBeNull();
  });

  it("names an industry the release publishes without a ROC as no reference", () => {
    const result = assembleValuationSnapshot(
      request({ industryReturns: industryReturns(null) }),
    );

    expect(
      result.status === "assembled" &&
        result.input.derivedAssumptions?.version ===
          "derived-assumptions-2.0.0" &&
        result.input.derivedAssumptions.industryReturn,
    ).toBeNull();
  });

  it("is deterministic: the same reading is the same input", () => {
    const left = assembleValuationSnapshot(request());
    const right = assembleValuationSnapshot(request());

    expect(left).toEqual(right);
  });

  it("names the gap before a snapshot exists", () => {
    expect(
      assembleValuationSnapshot(request({ employeeEquity: null })),
    ).toEqual({ status: "not_assembled", gap: "employee_equity_not_proposed" });
    expect(assembleValuationSnapshot(request({ shareCounts: [] }))).toEqual({
      status: "not_assembled",
      gap: "shares_outstanding_unavailable",
    });
    expect(
      assembleValuationSnapshot(
        request({ employeeEquity: stored(OUTSTANDING) }),
      ),
    ).toEqual({ status: "not_assembled", gap: "market_unavailable" });
    expect(
      assembleValuationSnapshot(
        request({ subject: { ...request().subject, securityId: null } }),
      ),
    ).toEqual({ status: "not_assembled", gap: "security_missing" });
    expect(
      assembleValuationSnapshot(
        request({
          assessment: {
            ...ASSESSMENT,
            costOfCapital: {
              status: "unsupported",
              version: "cost-of-capital-1.1.0",
              missing: ["betas"],
            },
          } as unknown as CompanyAssessment,
        }),
      ),
    ).toEqual({ status: "not_assembled", gap: "cost_of_capital_unavailable" });
    expect(
      assembleValuationSnapshot(
        request({
          assessment: { ...ASSESSMENT, normalization: null },
        }),
      ),
    ).toEqual({ status: "not_assembled", gap: "normalization_unavailable" });
    expect(
      assembleValuationSnapshot(
        request({
          assessment: {
            ...ASSESSMENT,
            fundamentals: {
              anchor: "2024-12-31",
              series: {
                ...SERIES,
                fiscalYears: SERIES.fiscalYears.slice(0, 2),
              },
            },
          },
        }),
      ),
    ).toEqual({ status: "not_assembled", gap: "revenue_history_insufficient" });
  });

  it("derives assumptions only for fcff_base", () => {
    const growth = {
      ...ASSESSMENT,
      selection: {
        ...demo.assessment.selection,
        recommendedMethod: "fcff_three_stage",
      },
    } as CompanyAssessment;

    expect(assembleValuationSnapshot(request({ assessment: growth }))).toEqual({
      status: "not_assembled",
      gap: "method_not_derived",
    });
  });

  it("ignores share counts known after the cutoff", () => {
    expect(
      assembleValuationSnapshot(
        request({
          shareCounts: [
            {
              ...request().shareCounts[0]!,
              availableAt: "2025-06-15T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toEqual({
      status: "not_assembled",
      gap: "shares_outstanding_unavailable",
    });
  });
});
