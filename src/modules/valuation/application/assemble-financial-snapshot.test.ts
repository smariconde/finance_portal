import { describe, expect, it } from "vitest";

import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { selectValuationMethod } from "../domain/method-selection";
import { runExcessReturn } from "./run-excess-return";
import { assembleFinancialSnapshot } from "./assemble-financial-snapshot";
import type { ValuationSnapshotRequest } from "./assemble-valuation-snapshot";
import type { StoredFinancialDeclaration } from "../domain/financial-declaration";
import type { CompanyAssessment } from "./assess-company";
import {
  OPTIONS_OUTSTANDING_CONCEPT,
  SHARES_OUTSTANDING_CONCEPT,
} from "../domain/employee-equity-claim";

const base = fixtureFinancialValuation();
const knownAt = "2025-08-01T00:00:00.000Z";
const observationId = "70000000-0000-4000-8000-000000000001";
const book = (value: string, asOf: string) => ({
  value,
  asOf,
  currency: "USD",
  unit: "monetary" as const,
  availableAt: "2025-07-15T12:00:00.000Z",
  sourceId: "sec-edgar",
  sourceDocumentId: "synthetic-financial-10k",
  observationId,
  qualityFlags: [],
});
const query: ValuationSnapshotRequest["query"] = {
  ...base.knowledge,
  effectiveAt: knownAt,
  knownAt,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
};
const assessment = {
  selection: selectValuationMethod({
    legalEntityId: base.subject.legalEntityId,
    knowledge: query,
    evidence: base.profileEvidence,
    fcffInputsComplete: false,
    excessReturnMissingInputs: [],
  }),
  evidence: base.profileEvidence,
  financialEquity: {
    status: "ready",
    fiscalYearEnd: "2024-12-31",
    commonBookEquity: book("100", "2024-12-31"),
    currentBook: book("100", "2024-12-31"),
    priorBook: book("100", "2023-12-31"),
    commonIncome: book("11", "2024-12-31"),
    roe: "0.11",
  },
  financialRisk: {
    status: "ready",
    risk: base.risk,
    equityBeta: { ...base.risk.riskFree!, value: "1.4" },
  },
} as unknown as CompanyAssessment;
const declaration: StoredFinancialDeclaration = {
  version: "financial-declaration-1.0.0",
  declarationId: "70000000-0000-4000-8000-000000000003",
  legalEntityId: base.subject.legalEntityId,
  fiscalYearEnd: "2024-12-31",
  payout: "0.5",
  rationale: "Owner expects half of common earnings to be distributable.",
  sourceDocumentId: "synthetic-review-2025",
  regulatoryCapital:
    "Owner reviewed regulatory capital and found no immediate breach.",
  assetQuality:
    "Owner reviewed loan quality and did not assert reserve sufficiency.",
  cleanSurplus: "Owner reviewed the change in common book and identified OCI.",
  commonBook: null,
  availableAt: "2025-07-20T00:00:00.000Z",
  recordedAt: "2025-07-20T00:00:00.000Z",
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    subject: {
      legalEntityId: base.subject.legalEntityId,
      securityId: base.subject.securityId,
      listingId: base.subject.listingId,
    },
    query,
    assessment,
    fundamentalsSourceId: "sec-edgar",
    declaration,
    employeeEquity: null,
    shareCounts: [
      {
        concept: SHARES_OUTSTANDING_CONCEPT,
        asOf: "2025-06-30",
        availableAt: "2025-07-15T12:00:00.000Z",
        value: "10",
        observationId,
        sourceDocumentId: "synthetic-cover",
      },
    ],
    employeeOptionFacts: [
      {
        concept: OPTIONS_OUTSTANDING_CONCEPT,
        asOf: "2024-12-31",
        availableAt: "2025-07-15T12:00:00.000Z",
        value: "0",
        observationId,
        sourceDocumentId: "synthetic-financial-10k",
      },
    ],
    prices: {
      sourceId: "yahoo-finance",
      closes: [{ marketDate: "2025-07-31", close: "14", currency: "USD" }],
      events: [],
    },
    industryReturns: null,
    ...overrides,
  } as ValuationSnapshotRequest & {
    declaration: StoredFinancialDeclaration | null;
  };
}

describe("financial-snapshot-1.0.0", () => {
  it("derives a reproducible excess-return run from reported equity and a private review", () => {
    const snapshot = assembleFinancialSnapshot(request());
    expect(snapshot.status).toBe("assembled");
    if (snapshot.status !== "assembled") return;
    expect(snapshot.input.derivedFinancial?.roe).toBe("0.11");
    expect(snapshot.input.assumptions.periods).toHaveLength(10);
    const run = runExcessReturn(snapshot.input, {
      now: () => knownAt,
      newValuationRunId: () => observationId,
    });
    expect(run.status).toBe("requires_review");
    expect(run.result?.base.valuePerShare).not.toBeNull();
  });

  it("does not invent an owner payout or review", () => {
    expect(
      assembleFinancialSnapshot(request({ declaration: null })),
    ).toMatchObject({
      status: "not_assembled",
      gap: "financial_declaration_missing",
    });
  });

  it("rejects a first-year ROE that no longer matches the reported common-income bridge", () => {
    const snapshot = assembleFinancialSnapshot(request());
    if (snapshot.status !== "assembled")
      throw new Error("Expected a financial snapshot.");
    const tampered = {
      ...snapshot.input,
      assumptions: {
        ...snapshot.input.assumptions,
        periods: [
          { ...snapshot.input.assumptions.periods[0]!, roe: "0.2" },
          ...snapshot.input.assumptions.periods.slice(1),
        ],
      },
    };
    const run = runExcessReturn(tampered, {
      now: () => knownAt,
      newValuationRunId: () => observationId,
    });
    expect(run.status).toBe("rejected");
    expect(run.failure?.code).toBe("policy_check_failed");
  });

  it("refuses a stale balance and a stale share count", () => {
    expect(
      assembleFinancialSnapshot(
        request({
          query: {
            ...query,
            effectiveAt: "2026-10-02T00:00:00.000Z",
            knownAt: "2026-10-02T00:00:00.000Z",
          },
          prices: {
            sourceId: "yahoo-finance",
            closes: [
              { marketDate: "2026-10-01", close: "14", currency: "USD" },
            ],
            events: [],
          },
        }),
      ),
    ).toMatchObject({ status: "not_assembled", gap: "financial_base_stale" });
    expect(
      assembleFinancialSnapshot(
        request({
          shareCounts: [
            {
              concept: SHARES_OUTSTANDING_CONCEPT,
              asOf: "2024-12-31",
              availableAt: "2025-07-15T12:00:00.000Z",
              value: "10",
              observationId,
              sourceDocumentId: "synthetic-cover",
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: "not_assembled",
      gap: "shares_outstanding_unavailable",
    });
  });
});
