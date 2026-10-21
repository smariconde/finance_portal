import {
  reitInputSchema,
  REIT_ENGINE_VERSION,
  REIT_METHODOLOGY_VERSION,
  type ReitInput,
} from "../domain/reit-input";
import { fixtureFinancialValuation } from "./fixture-financial-valuation";

/** Synthetic property REIT; no captured issuer data or product fallback. */
export function fixtureReitValuation(): ReitInput {
  const shared = fixtureFinancialValuation();
  const fact = (value: string, asOf = "2024-12-31") => ({
    ...shared.commonBookEquity!,
    asOf,
    value,
  });
  const period = {
    affoGrowth: "0.02",
    returnOnNewEquity: "0.12",
    equityBeta: "1.4",
  };
  const assumptions = {
    rationale:
      "Synthetic stable leverage and growth funded with retained common AFFO.",
    periods: [period, { ...period }],
    terminal: { growth: "0.02", returnOnNewEquity: "0.12", equityBeta: "1.4" },
    nav: {
      forwardNoi: "15",
      capRate: "0.06",
      rationale:
        "Synthetic consolidated forward NOI and matching cap rate, net of property costs.",
    },
  };
  return reitInputSchema.parse({
    method: "affo_nav",
    engineVersion: REIT_ENGINE_VERSION,
    methodologyVersion: REIT_METHODOLOGY_VERSION,
    decimalPolicy: shared.decimalPolicy,
    subject: shared.subject,
    asOf: shared.asOf,
    currency: shared.currency,
    knowledge: shared.knowledge,
    assetProfile: "reit",
    profileEvidence: shared.profileEvidence.map((e) => ({
      ...e,
      profile: "reit",
      rule: "fixture-reit-1.0.0",
    })),
    propertyBasis: "equity_property",
    scopeRationale:
      "Synthetic equity property REIT, with no mortgage or hybrid business.",
    affo: {
      version: "affo-reconciliation-1.0.0",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      rationale:
        "Common attributable annual results, JV/NCI amounts proportionate; no employee compensation addback.",
      commonNetIncome: fact("8"),
      realEstateDepreciation: fact("6"),
      propertySaleGains: fact("2"),
      realEstateImpairments: fact("1"),
      jointVentureAdjustment: fact("0"),
      recurringCapex: fact("2"),
      straightLineRent: fact("1"),
    },
    nav: {
      asOf: shared.asOf,
      availableAt: shared.commonBookEquity!.availableAt,
      sourceId: "fixture-financials",
      sourceDocumentId: "synthetic-reit-property-evidence",
      basis: "consolidated_forward_noi",
      rationale:
        "Consolidated properties and claims, with JV equity in other assets; corporate overhead already deducted in the synthetic NOI. All cash is nonoperating.",
      excessCash: fact("5", shared.asOf),
      nonPropertyAssets: fact("3", shared.asOf),
      debt: fact("70", shared.asOf),
      preferredEquity: fact("4", shared.asOf),
      noncontrollingInterests: fact("2", shared.asOf),
      otherLiabilities: fact("2", shared.asOf),
      corporateCostValue: fact("0", shared.asOf),
    },
    risk: shared.risk,
    employeeEquity: shared.employeeEquity,
    employeeEquityAvailableAt: shared.employeeEquityAvailableAt,
    assumptions,
    scenarios: {
      bear: {
        ...structuredClone(assumptions),
        rationale: "Lower growth with lower NOI and higher cap rate.",
        periods: assumptions.periods.map((p) => ({ ...p, affoGrowth: "0.01" })),
        terminal: { ...assumptions.terminal, growth: "0.01" },
        nav: { ...assumptions.nav, forwardNoi: "14", capRate: "0.07" },
      },
      bull: {
        ...structuredClone(assumptions),
        rationale: "Higher growth with higher NOI and lower cap rate.",
        periods: assumptions.periods.map((p) => ({ ...p, affoGrowth: "0.03" })),
        terminal: { ...assumptions.terminal, growth: "0.03" },
        nav: { ...assumptions.nav, forwardNoi: "16", capRate: "0.05" },
      },
    },
    sensitivity: {
      terminalEquityBetas: ["1", "1.4", "2"],
      terminalGrowthRates: ["0", "0.02", "0.04"],
      capRates: ["0.05", "0.06", "0.07", "0"],
    },
  });
}
