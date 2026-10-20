import { deriveEmployeeEquity } from "../domain/employee-equity-claim";
import {
  excessReturnInputSchema,
  EXCESS_RETURN_ENGINE_VERSION,
  EXCESS_RETURN_METHODOLOGY_VERSION,
  type ExcessReturnInput,
} from "../domain/excess-return-input";
import { DEMO_VALUATION_INPUT } from "./demo-valuation-fixtures";

/** Synthetic financial institution, only for tests; no live company is implied. */
export function fixtureFinancialValuation(): ExcessReturnInput {
  const shared = DEMO_VALUATION_INPUT;
  const employee = structuredClone(shared.employeeEquity);
  employee.sharesOutstanding.value = "10";
  employee.market = null;
  employee.decision.transcription = {
    decision: "proposed",
    scale: "units",
    optionsStatus: "none_disclosed",
    optionsCount: null,
    optionsCountQuote: null,
    optionsStrike: null,
    optionsStrikeQuote: null,
    optionsLifeBasis: null,
    optionsLife: null,
    optionsLifeQuote: null,
    optionsRanges: [],
    unitsStatus: "none_disclosed",
    units: [],
    confidence: "high",
    rationale: "Synthetic note declares no employee claims.",
    abstainReason: null,
  };
  employee.derived = deriveEmployeeEquity({ ...employee, riskFree: "0.03" });
  const provenance = {
    asOf: shared.asOf,
    availableAt: "2025-07-15T12:00:00.000Z",
    sourceId: "fixture-financials",
    sourceDocumentId: "synthetic-financial-evidence",
    observationId: null,
    qualityFlags: [],
  };
  return excessReturnInputSchema.parse({
    method: "excess_return",
    engineVersion: EXCESS_RETURN_ENGINE_VERSION,
    methodologyVersion: EXCESS_RETURN_METHODOLOGY_VERSION,
    decimalPolicy: shared.decimalPolicy,
    subject: shared.subject,
    asOf: shared.asOf,
    currency: "USD",
    knowledge: { ...shared.knowledge, knownAt: "2025-08-01T00:00:00.000Z" },
    assetProfile: "bank",
    profileEvidence: [
      {
        legalEntityId: shared.subject.legalEntityId,
        profile: "bank",
        present: true,
        rule: "fixture-bank-1.0.0",
        derivation: "primary",
        validFrom: "2024-01-01T00:00:00.000Z",
        validTo: null,
        availableAt: provenance.availableAt,
        recordedAt: provenance.availableAt,
        supersededAt: null,
        sourceId: provenance.sourceId,
        sourceDocumentId: provenance.sourceDocumentId,
        contentHash: "a".repeat(64),
      },
    ],
    commonBookEquity: {
      ...provenance,
      value: "100",
      currency: "USD",
      unit: "monetary",
    },
    risk: {
      riskFree: {
        ...provenance,
        value: "0.03",
        currency: "USD",
        unit: "fraction",
      },
      matureErp: {
        ...provenance,
        value: "0.05",
        currency: "USD",
        unit: "fraction",
      },
      countryRiskPremium: {
        ...provenance,
        value: "0",
        currency: "USD",
        unit: "fraction",
      },
      countryRiskBasis: "domicile",
      rationale: "Synthetic country risk is explicitly zero.",
    },
    employeeEquity: employee,
    employeeEquityAvailableAt: provenance.availableAt,
    financialReview: {
      regulatoryCapital: null,
      assetQuality: null,
      cleanSurplus: null,
    },
    assumptions: {
      rationale: "Synthetic ROE converges to cost of equity after two years.",
      periods: [
        { roe: "0.12", payout: "0.5", equityBeta: "1.4" },
        { roe: "0.12", payout: "0.5", equityBeta: "1.4" },
      ],
      terminal: { roe: "0.1", growth: "0.03", equityBeta: "1.4" },
    },
    scenarios: null,
    sensitivity: null,
  });
}
