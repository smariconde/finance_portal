import { describe, expect, it } from "vitest";

import { fixtureFinancialValuation } from "../infrastructure/fixture-financial-valuation";
import { fixtureReitValuation } from "../infrastructure/fixture-reit-valuation";
import { selectValuationMethod } from "../domain/method-selection";
import { SHARES_OUTSTANDING_CONCEPT } from "../domain/employee-equity-claim";
import type { LineItemId, LineItemValue } from "../domain/annual-fundamentals";
import { replayReitRun, runReit } from "./run-reit";
import { assembleReitSnapshot } from "./assemble-reit-snapshot";
import type { ValuationSnapshotRequest } from "./assemble-valuation-snapshot";
import type { CompanyAssessment } from "./assess-company";

const shared = fixtureFinancialValuation();
const reit = fixtureReitValuation();
const knownAt = "2025-08-01T00:00:00.000Z";
const observationId = "70000000-0000-4000-8000-000000000002";
const query: ValuationSnapshotRequest["query"] = {
  ...shared.knowledge,
  effectiveAt: knownAt,
  knownAt,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
};

function item(
  id: LineItemId,
  concept: string,
  value: string,
  asOf = "2024-12-31",
): LineItemValue {
  return {
    item: id,
    concept: `us-gaap:${concept}`,
    value,
    unit: "USD",
    currency: "USD",
    asOf,
    observationId,
    availableAt: "2025-02-15T12:00:00.000Z",
    recordedAt: "2025-02-16T12:00:00.000Z",
    sourceDocumentId: "synthetic-reit-10k",
  };
}

const baseItems = {
  revenue: item("revenue", "Revenues", "24"),
  common_net_income: item(
    "common_net_income",
    "NetIncomeLossAvailableToCommonStockholdersBasic",
    "8",
  ),
  real_estate_depreciation: item(
    "real_estate_depreciation",
    "DepreciationAndAmortization",
    "6",
  ),
  property_sale_gains: item(
    "property_sale_gains",
    "GainsLossesOnSalesOfInvestmentRealEstate",
    "2",
  ),
  recurring_capex: item(
    "recurring_capex",
    "PaymentsForCapitalImprovements",
    "2",
  ),
  real_estate_property_net: item(
    "real_estate_property_net",
    "RealEstateInvestmentPropertyNet",
    "150",
  ),
  assets: item("assets", "Assets", "200"),
  equity: item("equity", "StockholdersEquity", "100"),
};

function assessment(
  items: Partial<Record<LineItemId, LineItemValue>> = baseItems,
  risk: unknown = {
    status: "ready",
    risk: shared.risk,
    equityBeta: { ...shared.risk.riskFree!, value: "0.9" },
  },
) {
  return {
    selection: selectValuationMethod({
      legalEntityId: shared.subject.legalEntityId,
      knowledge: query,
      evidence: reit.profileEvidence,
      fcffInputsComplete: false,
      reitMissingInputs: [],
    }),
    evidence: reit.profileEvidence,
    fundamentals: {
      series: {
        version: "annual-fundamentals-1.6.0",
        fiscalYears: [
          { fiscalYearEnd: "2024-12-31", items },
          {
            fiscalYearEnd: "2023-12-31",
            items: { revenue: item("revenue", "Revenues", "22", "2023-12-31") },
          },
          {
            fiscalYearEnd: "2022-12-31",
            items: { revenue: item("revenue", "Revenues", "20", "2022-12-31") },
          },
        ],
      },
    },
    financialRisk: risk,
  } as unknown as CompanyAssessment;
}

function request(overrides: Partial<ValuationSnapshotRequest> = {}) {
  return {
    subject: {
      legalEntityId: shared.subject.legalEntityId,
      securityId: shared.subject.securityId,
      listingId: shared.subject.listingId,
    },
    query,
    assessment: assessment(),
    fundamentalsSourceId: "sec-edgar",
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
    employeeOptionFacts: [],
    prices: {
      sourceId: "yahoo-finance",
      closes: [{ marketDate: "2025-07-31", close: "14", currency: "USD" }],
      events: [],
    },
    industryReturns: null,
    ...overrides,
  } satisfies ValuationSnapshotRequest;
}

const dependencies = {
  now: () => knownAt,
  newValuationRunId: () => observationId,
};

describe("reit-snapshot-1.0.0", () => {
  it("values a property REIT from XBRL, naming what it did not adjust", () => {
    const snapshot = assembleReitSnapshot(request());
    expect(snapshot.status).toBe("assembled");
    if (snapshot.status !== "assembled") return;
    const input = snapshot.input;
    expect(input.engineVersion).toBe("affo-nav-1.1.0");
    expect(input.nav).toBeNull();
    expect(input.affo.realEstateImpairments).toBeNull();
    expect(input.affo.straightLineRent).toBeNull();
    expect(input.derivedReit?.affoBasis.recurringCapex).toBe(
      "us-gaap:PaymentsForCapitalImprovements",
    );
    expect(input.derivedReit?.commonEquityBasis).toBe(
      "equity_without_preferred_tagged",
    );
    expect(input.employeeEquity?.decision.basis).toBe("not_subtracted");
    expect(input.assumptions.periods).toHaveLength(10);
    // 0.3 × AFFO/patrimonio = 0.3 × 10/100 = 0.03 < tendencia de ventas.
    expect(input.assumptions.periods[0]!.affoGrowth).toBe("0.03");

    const run = runReit(input, dependencies);
    expect(run.failure).toBeNull();
    expect(run.status).toBe("requires_review");
    expect(run.result?.base.reconciliation.affo).toBe("10");
    expect(run.result?.base.reconciliation.notAdjusted).toEqual([
      "realEstateImpairments",
      "jointVentureAdjustment",
      "straightLineRent",
    ]);
    expect(run.result?.base.nav).toBeNull();
    expect(run.result?.base.dcfMinusNavPerShare).toBeNull();
    const failed = run.result?.checks
      .filter((check) => check.status === "failed")
      .map((check) => check.id);
    expect(failed).toContain("reit_affo_not_adjusted");
    expect(failed).toContain("reit_nav_declared_absent");
    expect(failed).not.toContain("reit_assumptions_derived_recomputed");
    expect(replayReitRun(run).outcome).toBe("reproduced");
  });

  it("rejects assumptions that do not rebuild from the frozen derivation", () => {
    const snapshot = assembleReitSnapshot(request());
    if (snapshot.status !== "assembled") throw new Error("not assembled");
    const tampered = structuredClone(snapshot.input);
    tampered.assumptions.periods[0]!.affoGrowth = "0.05";
    const run = runReit(tampered, dependencies);
    expect(run.status).toBe("rejected");
    expect(run.failure?.subjects).toContain("assumptions");
  });

  it("never reads an untagged component as tagged, nor the reverse", () => {
    const snapshot = assembleReitSnapshot(request());
    if (snapshot.status !== "assembled") throw new Error("not assembled");
    const tampered = structuredClone(snapshot.input);
    tampered.affo.propertySaleGains = null;
    const run = runReit(tampered, dependencies);
    expect(run.status).toBe("rejected");
    expect(run.failure?.subjects).toContain(
      "derivedReit.affoBasis.propertySaleGains",
    );
  });

  it("does not treat a mostly non-property balance sheet as an equity REIT", () => {
    const items = {
      ...baseItems,
      real_estate_property_net: item(
        "real_estate_property_net",
        "RealEstateInvestmentPropertyNet",
        "40",
      ),
    };
    expect(
      assembleReitSnapshot(request({ assessment: assessment(items) })),
    ).toEqual({
      status: "not_assembled",
      gap: "reit_property_basis_unavailable",
    });
  });

  it("names a missing AFFO anchor instead of inventing it", () => {
    const items: Partial<typeof baseItems> = { ...baseItems };
    delete items.real_estate_depreciation;
    expect(
      assembleReitSnapshot(request({ assessment: assessment(items) })),
    ).toEqual({ status: "not_assembled", gap: "reit_affo_anchor_unavailable" });
  });

  it("needs the industry cost of equity", () => {
    expect(
      assembleReitSnapshot(
        request({
          assessment: assessment(baseItems, {
            status: "unavailable",
            reason: "industry_missing",
          }),
        }),
      ),
    ).toEqual({ status: "not_assembled", gap: "cost_of_capital_unavailable" });
  });

  it("names nonpositive AFFO instead of deriving growth from it", () => {
    const items = {
      ...baseItems,
      common_net_income: item(
        "common_net_income",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
        "-20",
      ),
    };
    expect(
      assembleReitSnapshot(request({ assessment: assessment(items) })),
    ).toEqual({ status: "not_assembled", gap: "financial_base_unavailable" });
  });

  it("keeps affo-nav-1.0.0 runs on their own contract", () => {
    const run = runReit(reit, dependencies);
    expect(run.engineVersion).toBe("affo-nav-1.0.0");
    expect(run.result?.base.reconciliation.notAdjusted).toBeUndefined();
    expect(run.result?.base.nav).not.toBeNull();
    expect(replayReitRun(run).outcome).toBe("reproduced");
  });
});
