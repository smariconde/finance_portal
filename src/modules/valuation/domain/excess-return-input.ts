import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import { decimalPolicySchema, engineDecimalSchema } from "./decimal-policy";
import { employeeEquityClaimSchema } from "./employee-equity-claim";
import { profileEvidenceSchema } from "./method-selection";
import {
  currencySchema,
  factProvenanceShape,
  monetaryFactSchema,
} from "./valuation-facts";
import { valuationSubjectSchema } from "./valuation-input";

export const EXCESS_RETURN_ENGINE_VERSION = "excess-return-1.0.0";
export const EXCESS_RETURN_METHODOLOGY_VERSION = "financial-equity-1.0.0";
export const DERIVED_EXCESS_RETURN_ENGINE_VERSION = "excess-return-1.1.0";
export const DERIVED_EXCESS_RETURN_METHODOLOGY_VERSION =
  "financial-equity-1.1.0";

/** A dated component in the valuation currency; beta is an equity assumption. */
export const financialRateFactSchema = z.object({
  ...factProvenanceShape,
  value: engineDecimalSchema,
  currency: currencySchema,
  unit: z.literal("fraction"),
});

export const financialPeriodSchema = z.strictObject({
  roe: engineDecimalSchema,
  payout: engineDecimalSchema,
  equityBeta: engineDecimalSchema,
});

export const financialAssumptionsSchema = z.strictObject({
  rationale: z.string().trim().min(1).max(1024),
  periods: z.array(financialPeriodSchema).min(1).max(20),
  terminal: z.strictObject({
    roe: engineDecimalSchema,
    growth: engineDecimalSchema,
    equityBeta: engineDecimalSchema,
  }),
});

/**
 * Financial equity has its own contract: no revenue, WACC or industrial bridge.
 * Missing structural inputs remain null and produce a recorded policy refusal.
 * All forecasts are annual, with the book measured at the valuation date.
 */
export const excessReturnInputSchema = z.strictObject({
  method: z.literal("excess_return"),
  engineVersion: z.enum([
    EXCESS_RETURN_ENGINE_VERSION,
    DERIVED_EXCESS_RETURN_ENGINE_VERSION,
  ]),
  methodologyVersion: z.enum([
    EXCESS_RETURN_METHODOLOGY_VERSION,
    DERIVED_EXCESS_RETURN_METHODOLOGY_VERSION,
  ]),
  decimalPolicy: decimalPolicySchema,
  subject: valuationSubjectSchema,
  asOf: z.iso.date(),
  currency: currencySchema,
  knowledge: pointInTimeQuerySchema,
  assetProfile: z.enum(["bank", "insurer"]),
  profileEvidence: z.array(profileEvidenceSchema).min(1).max(100),
  /** Common equity, after preferred equity and noncontrolling interests. */
  commonBookEquity: monetaryFactSchema.nullable(),
  /** F6-20: the reported common-income and prior-book facts behind the ROE. */
  derivedFinancial: z
    .strictObject({
      version: z.literal("derived-financial-equity-1.1.0"),
      commonIncome: monetaryFactSchema,
      priorBook: monetaryFactSchema,
      commonDividends: monetaryFactSchema,
      netRepurchases: monetaryFactSchema,
      payout: engineDecimalSchema,
      roe: engineDecimalSchema,
      equityBeta: financialRateFactSchema,
      filingSourceDocumentId: z.string().trim().min(1).max(256),
      filingAvailableAt: utcTimestampSchema,
    })
    .optional(),
  risk: z.strictObject({
    riskFree: financialRateFactSchema.nullable(),
    matureErp: financialRateFactSchema.nullable(),
    countryRiskPremium: financialRateFactSchema.nullable(),
    /** Explicit approximation when only the domicile CRP is known. */
    countryRiskBasis: z.enum(["operations", "domicile"]),
    rationale: z.string().trim().min(1).max(1024),
  }),
  employeeEquity: employeeEquityClaimSchema.nullable(),
  /** Acceptance of the note frozen by the decision, independent of the share register. */
  employeeEquityAvailableAt: utcTimestampSchema.nullable(),
  /** Evidence-backed reviews; absence does not certify solvency or asset quality. */
  financialReview: z.strictObject({
    regulatoryCapital: z.string().trim().min(1).max(1024).nullable(),
    assetQuality: z.string().trim().min(1).max(1024).nullable(),
    cleanSurplus: z.string().trim().min(1).max(1024).nullable(),
  }),
  assumptions: financialAssumptionsSchema,
  scenarios: z
    .strictObject({
      bear: financialAssumptionsSchema,
      bull: financialAssumptionsSchema,
    })
    .nullable(),
  /** Terminal beta × g; the explicit forecast and all dated risk facts stay fixed. */
  sensitivity: z
    .strictObject({
      terminalEquityBetas: z.array(engineDecimalSchema).min(1).max(11),
      terminalGrowthRates: z.array(engineDecimalSchema).min(1).max(11),
    })
    .nullable(),
});

export type ExcessReturnInput = z.infer<typeof excessReturnInputSchema>;
export type FinancialAssumptions = z.infer<typeof financialAssumptionsSchema>;

export function computeExcessReturnInputHash(
  candidate: ExcessReturnInput,
): string {
  return computeContentHash(excessReturnInputSchema.parse(candidate));
}
