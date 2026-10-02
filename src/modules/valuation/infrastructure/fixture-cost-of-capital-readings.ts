import type {
  ReferenceRelease,
  ReferenceRow,
} from "@/modules/reference-data/domain/reference-release";

import {
  BETAS_DATASET,
  COUNTRY_RISK_DATASET,
  IMPLIED_ERP_DATASET,
  RATINGS_DATASET,
  type ReferenceReading,
} from "../domain/cost-of-capital";

/**
 * Releases sintéticas con la forma de las de Damodaran, para tests y para la
 * corrida de referencia de `FixtureCo`. No son cifras de la fuente: los términos
 * no permiten redistribuirlas, y lo que se prueba es la aritmética.
 */
export type FixtureCostOfCapitalValues = {
  readonly treasuryBondRate: string;
  readonly sovereignDefaultSpread: string;
  readonly impliedErp: string;
  readonly countryRiskPremium: string;
  readonly countryDefaultSpread: string;
  readonly corporateTaxRate: string;
  readonly unleveredBeta: string;
  readonly debtToEquity: string;
};

export const FIXTURE_COST_OF_CAPITAL_VALUES: FixtureCostOfCapitalValues = {
  treasuryBondRate: "0.0418",
  sovereignDefaultSpread: "0.0023",
  impliedErp: "0.0423",
  countryRiskPremium: "0.0023",
  countryDefaultSpread: "0.0023",
  corporateTaxRate: "0.25",
  unleveredBeta: "1.32",
  debtToEquity: "0.0462",
};

const OBSERVED_AT = "2026-10-02T17:30:00.000Z";

function release(
  datasetId: string,
  releaseId: string,
  rows: number,
): ReferenceRelease {
  return {
    releaseId,
    datasetId,
    publishedLabel: "January 2026",
    parserVersion: "damodaran-html-1.0.0",
    rowCount: rows,
    ingestionRunId: "00000000-0000-4000-8000-0000000000f0",
    validFrom: OBSERVED_AT,
    validTo: null,
    availableAt: OBSERVED_AT,
    supersededAt: null,
    sourceId: "damodaran-current-data",
    sourceDocumentId: null,
    contentHash: "d".repeat(64),
    recordedAt: OBSERVED_AT,
  };
}

function reading(
  datasetId: string,
  releaseId: string,
  rows: ReferenceRow[],
): ReferenceReading {
  return { release: release(datasetId, releaseId, rows.length), rows };
}

const BANDS: readonly (readonly [string, string, string, string])[] = [
  ["-100000", "0.199999", "D2/D", "0.19"],
  ["0.2", "0.649999", "C2/C", "0.16"],
  ["0.65", "0.799999", "Ca2/CC", "0.1261"],
  ["0.8", "1.249999", "Caa/CCC", "0.0885"],
  ["1.25", "1.499999", "B3/B-", "0.0509"],
  ["1.5", "1.749999", "B2/B", "0.0321"],
  ["1.75", "1.999999", "B1/B+", "0.0275"],
  ["2", "2.2499999", "Ba2/BB", "0.0183"],
  ["2.25", "2.49999", "Ba1/BB+", "0.0138"],
  ["2.5", "2.999999", "Baa2/BBB", "0.0111"],
  ["3", "4.249999", "A3/A-", "0.0089"],
  ["4.25", "5.499999", "A2/A", "0.0078"],
  ["5.5", "6.499999", "A1/A+", "0.007"],
  ["6.5", "8.499999", "Aa2/AA", "0.0055"],
  ["8.50", "100000", "Aaa/AAA", "0.004"],
];

export function fixtureCostOfCapitalReadings(
  values: FixtureCostOfCapitalValues = FIXTURE_COST_OF_CAPITAL_VALUES,
  industryKey = "computers-peripherals",
  countryKey = "united-states",
) {
  return {
    betas: reading(BETAS_DATASET, "00000000-0000-4000-8000-0000000000b1", [
      {
        key: industryKey,
        label: "Fixture industry",
        values: {
          unlevered_beta_cash_corrected: values.unleveredBeta,
          debt_to_equity: values.debtToEquity,
        },
      },
    ]),
    countryRisk: reading(
      COUNTRY_RISK_DATASET,
      "00000000-0000-4000-8000-0000000000b2",
      [
        {
          key: countryKey,
          label: "Fixture country",
          values: {
            default_spread: values.countryDefaultSpread,
            country_risk_premium: values.countryRiskPremium,
            corporate_tax_rate: values.corporateTaxRate,
          },
        },
        ...(countryKey === "united-states"
          ? []
          : [
              {
                key: "united-states",
                label: "United States",
                values: {
                  default_spread: values.sovereignDefaultSpread,
                  country_risk_premium: values.countryRiskPremium,
                  corporate_tax_rate: values.corporateTaxRate,
                },
              },
            ]),
      ],
    ),
    impliedErp: reading(
      IMPLIED_ERP_DATASET,
      "00000000-0000-4000-8000-0000000000b3",
      [
        {
          key: "2024",
          label: "2024",
          values: { implied_erp: "0.0433", treasury_bond_rate: "0.0458" },
        },
        {
          key: "2025",
          label: "2025",
          values: {
            implied_erp: values.impliedErp,
            treasury_bond_rate: values.treasuryBondRate,
          },
        },
      ],
    ),
    ratings: reading(
      RATINGS_DATASET,
      "00000000-0000-4000-8000-0000000000b4",
      BANDS.map(([above, atMost, rating, spread], index) => ({
        key: `large-nonfinancial-${String(index + 1).padStart(2, "0")}`,
        label: `Large non-financial ${rating}`,
        values: {
          coverage_above: above,
          coverage_at_most: atMost,
          rating,
          spread,
        },
      })),
    ),
  };
}
