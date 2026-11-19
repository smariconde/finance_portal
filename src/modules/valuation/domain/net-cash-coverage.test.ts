import { describe, expect, it } from "vitest";

import {
  LINE_ITEMS,
  type AnnualFundamentals,
  type LineItemId,
  type LineItemValue,
} from "./annual-fundamentals";
import {
  assessNetCashCoverage,
  NET_CASH_COVERAGE_VERSION,
  netCashCoverageMismatches,
  netCashCoverageShortfall,
} from "./net-cash-coverage";
import type { ConceptFact } from "./valuation-facts";
import type { CoverageFloor } from "./zero-debt-evidence";

const END = "2026-01-31";
const FLOOR: CoverageFloor = {
  value: "8.5",
  datasetId: "damodaran.synthetic-ratings",
  releaseId: "6f1d1f4e-2a0b-4c55-8e0a-0f7d8f6a7b10",
  rowKey: "large-nonfinancial-aaa",
  availableAt: "2026-01-10T12:00:00.000Z",
};

let sequence = 0;

function line(item: LineItemId, value: string): LineItemValue {
  sequence += 1;
  return {
    item,
    concept: LINE_ITEMS.find((definition) => definition.item === item)!
      .concepts[0]!,
    value,
    unit: "USD",
    currency: "USD",
    asOf: END,
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    availableAt: "2026-03-10T21:00:00.000Z",
    recordedAt: "2026-03-11T00:00:00.000Z",
    sourceDocumentId: "0000000000-26-000001",
  };
}

/** CRWD FY2026 in round numbers: GAAP operating loss, notes, cash and OCF. */
const CRWD: Partial<Record<LineItemId, string>> = {
  revenue: "4800",
  operating_income: "-120",
  interest_expense: "26",
  equity: "4000",
  operating_cash_flow: "1500",
  cash: "4600",
  liquid_investments: "200",
  debt_long_term_noncurrent: "745",
};

function series(
  items: Partial<Record<LineItemId, string>> = CRWD,
): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.8.0",
    fiscalYears: [
      {
        fiscalYearEnd: END,
        items: Object.fromEntries(
          Object.entries(items).map(([id, value]) => [
            id,
            line(id as LineItemId, value),
          ]),
        ),
      },
    ],
  };
}

function toFact(item: LineItemValue): ConceptFact {
  return {
    value: item.value,
    currency: "USD",
    unit: "monetary",
    asOf: item.asOf,
    availableAt: item.availableAt,
    sourceId: "sec-edgar",
    sourceDocumentId: item.sourceDocumentId,
    observationId: item.observationId,
    qualityFlags: [],
    concept: item.concept,
  };
}

function without(
  items: Partial<Record<LineItemId, string>>,
  id: LineItemId,
): Partial<Record<LineItemId, string>> {
  return Object.fromEntries(
    Object.entries(items).filter(([key]) => key !== id),
  );
}

const assess = (items?: Partial<Record<LineItemId, string>>) =>
  assessNetCashCoverage(series(items), END, FLOOR, toFact);

describe(NET_CASH_COVERAGE_VERSION, () => {
  it("rates an operating loss with net cash and positive OCF at the top band (CRWD)", () => {
    const result = assess();
    expect(result.status).toBe("met");
    if (result.status !== "met") return;
    expect(result.evidence.coverageFloor).toEqual(FLOOR);
    expect(result.evidence.debt.map((entry) => entry.component)).toEqual([
      "longTermNoncurrent",
    ]);
    expect(result.evidence.liquid).toHaveLength(2);
    expect(netCashCoverageShortfall(result.evidence)).toBeNull();
    expect(netCashCoverageMismatches(result.evidence, "netCash")).toEqual([]);
  });

  it("does not run where the coverage measures something", () => {
    expect(assess({ ...CRWD, operating_income: "300" })).toEqual({
      status: "not_applicable",
    });
  });

  it.each([
    ["operating_cash_flow", "-50", "operating_cash_flow_not_positive"],
    ["operating_cash_flow", "0", "operating_cash_flow_not_positive"],
    ["equity", "-10", "equity_not_positive"],
    ["debt_long_term_noncurrent", "5000", "debt_exceeds_liquid_assets"],
  ] as const)(
    "names why a company does not qualify: %s = %s",
    (item, value, reason) => {
      expect(assess({ ...CRWD, [item]: value })).toEqual({
        status: "not_met",
        reason,
      });
    },
  );

  it("never takes an absent fact as zero", () => {
    expect(assess(without(CRWD, "operating_cash_flow"))).toEqual({
      status: "not_met",
      reason: "facts_missing",
    });
    expect(assess(without(CRWD, "interest_expense"))).toEqual({
      status: "not_met",
      reason: "facts_missing",
    });
  });

  it("refuses a debt no recipe resolves: an absence proves nothing", () => {
    expect(
      assess({
        ...without(CRWD, "debt_long_term_noncurrent"),
        debt_long_term_current: "100",
      }),
    ).toEqual({
      status: "not_met",
      reason: "debt_unresolved",
    });
  });

  it("refuses without a rating table at the cutoff", () => {
    expect(assessNetCashCoverage(series(), END, null, toFact)).toEqual({
      status: "not_met",
      reason: "coverage_floor_unavailable",
    });
  });

  it("rechecks a stored evidence from its frozen facts", () => {
    const result = assess();
    if (result.status !== "met") throw new Error(result.status);
    const tampered = structuredClone(result.evidence);
    tampered.operatingCashFlow.value = "-1";
    expect(netCashCoverageMismatches(tampered, "netCash")).toContain("netCash");
    const moved = structuredClone(result.evidence);
    moved.equity.asOf = "2025-01-31";
    expect(netCashCoverageMismatches(moved, "netCash")).toContain(
      "netCash.equity",
    );
  });
});
