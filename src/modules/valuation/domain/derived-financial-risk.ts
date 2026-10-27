import type { ReferenceDatasetReading } from "@/modules/reference-data/application/read-reference-dataset";

import { parseDecimal } from "./decimal-policy";
import type { ExcessReturnInput } from "./excess-return-input";

export const DERIVED_FINANCIAL_RISK_VERSION = "derived-financial-risk-1.0.0";
type Rate = NonNullable<ExcessReturnInput["risk"]["riskFree"]>;

export type DerivedFinancialRisk =
  | {
      readonly status: "ready";
      readonly risk: ExcessReturnInput["risk"];
      readonly equityBeta: Rate;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "industry_missing"
        | "country_unsupported"
        | "release_missing"
        | "row_missing"
        | "risk_field_missing";
    };

function fact(
  reading: ReferenceDatasetReading,
  value: string,
  field: string,
): Rate {
  return {
    value,
    currency: "USD",
    unit: "fraction",
    asOf: reading.release.availableAt.slice(0, 10),
    availableAt: reading.release.availableAt,
    sourceId: reading.release.sourceId,
    sourceDocumentId: `${reading.release.datasetId}:${reading.release.releaseId}:${field}`,
    observationId: null,
    qualityFlags: [],
  };
}

/** Equity beta is the published levered industry beta; deposits are not debt in Hamada. */
export function deriveFinancialRisk(readings: {
  readonly industryKey: string | null;
  readonly listingCountry: string | null;
  readonly betas: ReferenceDatasetReading | null;
  readonly countryRisk: ReferenceDatasetReading | null;
  readonly impliedErp: ReferenceDatasetReading | null;
}): DerivedFinancialRisk {
  if (readings.industryKey === null)
    return { status: "unavailable", reason: "industry_missing" };
  if (readings.listingCountry !== "US")
    return { status: "unavailable", reason: "country_unsupported" };
  const { betas, countryRisk, impliedErp } = readings;
  if (betas === null || countryRisk === null || impliedErp === null)
    return { status: "unavailable", reason: "release_missing" };
  const betaRow = betas.rows.find((row) => row.key === readings.industryKey);
  const country = countryRisk.rows.find((row) => row.key === "united-states");
  const market = [...impliedErp.rows]
    .sort((left, right) => right.key.localeCompare(left.key))
    .find(
      (row) =>
        row.values.treasury_bond_rate !== null &&
        row.values.implied_erp !== null,
    );
  if (betaRow === undefined || country === undefined || market === undefined)
    return { status: "unavailable", reason: "row_missing" };
  const beta = betaRow.values.beta;
  const treasury = market.values.treasury_bond_rate;
  const erp = market.values.implied_erp;
  const spread = country.values.default_spread;
  const crp = country.values.country_risk_premium;
  if (
    beta == null ||
    treasury == null ||
    erp == null ||
    spread == null ||
    crp == null
  )
    return { status: "unavailable", reason: "risk_field_missing" };
  const riskFree = parseDecimal(treasury, "treasury")
    .minus(parseDecimal(spread, "sovereignSpread"))
    .toString();
  return {
    status: "ready",
    risk: {
      riskFree: {
        ...fact(impliedErp, riskFree, "treasury_minus_sovereign_spread"),
        sourceDocumentId: `${impliedErp.release.releaseId}+${countryRisk.release.releaseId}:risk_free`,
        availableAt:
          impliedErp.release.availableAt > countryRisk.release.availableAt
            ? impliedErp.release.availableAt
            : countryRisk.release.availableAt,
        asOf: (impliedErp.release.availableAt > countryRisk.release.availableAt
          ? impliedErp.release.availableAt
          : countryRisk.release.availableAt
        ).slice(0, 10),
        qualityFlags: ["net_of_sovereign_spread"],
      },
      matureErp: fact(impliedErp, erp, "implied_erp"),
      countryRiskPremium: fact(countryRisk, crp, "country_risk_premium"),
      countryRiskBasis: "domicile",
      rationale:
        "U.S. listing domicile; no accepted operations exposure was applied.",
    },
    equityBeta: fact(betas, beta, "beta"),
  };
}
