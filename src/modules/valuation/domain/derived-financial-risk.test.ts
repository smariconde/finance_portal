import { describe, expect, it } from "vitest";

import type { ReferenceDatasetReading } from "@/modules/reference-data/application/read-reference-dataset";

import { deriveFinancialRisk } from "./derived-financial-risk";

function reading(
  datasetId: string,
  rows: { key: string; values: Record<string, string | null> }[],
): ReferenceDatasetReading {
  return {
    release: {
      releaseId: "70000000-0000-4000-8000-000000000001",
      datasetId,
      publishedLabel: "Synthetic 2025",
      parserVersion: "fixture-1.0.0",
      rowCount: rows.length,
      ingestionRunId: "70000000-0000-4000-8000-000000000002",
      validFrom: "2025-07-01T00:00:00.000Z",
      validTo: null,
      availableAt: "2025-07-01T00:00:00.000Z",
      supersededAt: null,
      sourceId: "damodaran-current-data",
      sourceDocumentId: "synthetic",
      contentHash: "a".repeat(64),
      recordedAt: "2025-07-01T00:00:00.000Z",
    },
    rows: rows.map((row) => ({ ...row, label: row.key })),
  };
}

const input = {
  industryKey: "bank-money-center",
  listingCountry: "US",
  betas: reading("damodaran.betas-us", [
    {
      key: "bank-money-center",
      values: {
        beta: "1.2",
        unlevered_beta_cash_corrected: "0.8",
        debt_to_equity: "3",
      },
    },
  ]),
  countryRisk: reading("damodaran.country-risk", [
    {
      key: "united-states",
      values: { default_spread: "0.005", country_risk_premium: "0.01" },
    },
  ]),
  impliedErp: reading("damodaran.implied-erp", [
    {
      key: "2025",
      values: { treasury_bond_rate: "0.04", implied_erp: "0.05" },
    },
  ]),
};

describe("derived-financial-risk-1.0.0", () => {
  it("uses the published equity beta and nets sovereign spread from Treasury", () => {
    expect(deriveFinancialRisk(input)).toMatchObject({
      status: "ready",
      equityBeta: { value: "1.2" },
      risk: {
        riskFree: { value: "0.035" },
        matureErp: { value: "0.05" },
        countryRiskPremium: { value: "0.01" },
        countryRiskBasis: "domicile",
      },
    });
  });

  it("keeps absent releases and unsupported countries missing", () => {
    expect(deriveFinancialRisk({ ...input, betas: null })).toMatchObject({
      status: "unavailable",
      reason: "release_missing",
    });
    expect(
      deriveFinancialRisk({ ...input, listingCountry: "AR" }),
    ).toMatchObject({ status: "unavailable", reason: "country_unsupported" });
  });

  it("uses the newest dated market row even when the release rows are unordered", () => {
    const impliedErp = reading("damodaran.implied-erp", [
      {
        key: "2025",
        values: { treasury_bond_rate: "0.04", implied_erp: "0.05" },
      },
      {
        key: "2024",
        values: { treasury_bond_rate: "0.03", implied_erp: "0.04" },
      },
    ]);
    expect(deriveFinancialRisk({ ...input, impliedErp })).toMatchObject({
      status: "ready",
      risk: { riskFree: { value: "0.035" }, matureErp: { value: "0.05" } },
    });
  });
});
