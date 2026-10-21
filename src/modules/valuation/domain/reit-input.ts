import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { engineDecimalSchema } from "./decimal-policy";
import { excessReturnInputSchema } from "./excess-return-input";
import { monetaryFactSchema } from "./valuation-facts";

export const REIT_ENGINE_VERSION = "affo-nav-1.0.0";
export const REIT_METHODOLOGY_VERSION = "reit-equity-1.0.0";

const rationale = z.string().trim().min(1).max(1024);
const amount = monetaryFactSchema.nullable();

/** Annual common-equity amounts: JV/NCI effects are already proportionate. */
export const affoReconciliationSchema = z.strictObject({
  version: z.literal("affo-reconciliation-1.0.0"),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  rationale,
  commonNetIncome: amount,
  realEstateDepreciation: amount,
  /** Signed: gains positive, losses negative; both are removed. */
  propertySaleGains: amount,
  realEstateImpairments: amount,
  /** Signed additive adjustment to FFO for unconsolidated interests. */
  jointVentureAdjustment: amount,
  /** All recurring maintenance, tenant improvements and leasing commissions. */
  recurringCapex: amount,
  /** Signed GAAP rent less cash rent; subtracted from FFO. */
  straightLineRent: amount,
});

export const reitAssumptionsSchema = z.strictObject({
  rationale,
  /** Growth is funded by retention = growth / return on incremental equity. */
  periods: z
    .array(
      z.strictObject({
        affoGrowth: engineDecimalSchema,
        returnOnNewEquity: engineDecimalSchema,
        equityBeta: engineDecimalSchema,
      }),
    )
    .min(1)
    .max(20),
  terminal: z.strictObject({
    growth: engineDecimalSchema,
    returnOnNewEquity: engineDecimalSchema,
    equityBeta: engineDecimalSchema,
  }),
  /** Forward twelve-month NOI, before financing; cap rate uses the same basis. */
  nav: z.strictObject({
    forwardNoi: engineDecimalSchema,
    capRate: engineDecimalSchema,
    rationale,
  }),
});

/** Equity property REITs only. Mortgage REITs need a separate asset model. */
export const reitInputSchema = z.strictObject({
  method: z.literal("affo_nav"),
  engineVersion: z.literal(REIT_ENGINE_VERSION),
  methodologyVersion: z.literal(REIT_METHODOLOGY_VERSION),
  decimalPolicy: excessReturnInputSchema.shape.decimalPolicy,
  subject: excessReturnInputSchema.shape.subject,
  asOf: excessReturnInputSchema.shape.asOf,
  currency: excessReturnInputSchema.shape.currency,
  knowledge: excessReturnInputSchema.shape.knowledge,
  assetProfile: z.literal("reit"),
  profileEvidence: excessReturnInputSchema.shape.profileEvidence,
  propertyBasis: z.enum(["equity_property", "mortgage", "hybrid"]),
  scopeRationale: rationale,
  affo: affoReconciliationSchema,
  /** Consolidated NOI and claims: no proportionate/consolidated mixing. */
  nav: z.strictObject({
    asOf: z.iso.date(),
    availableAt: excessReturnInputSchema.shape.employeeEquityAvailableAt,
    sourceId: z.string().trim().min(3).max(64),
    sourceDocumentId: z.string().trim().min(1).max(256).nullable(),
    basis: z.literal("consolidated_forward_noi"),
    /** Explains NOI, cap-rate evidence, coverage, G&A and JV treatment. */
    rationale,
    excessCash: amount,
    nonPropertyAssets: amount,
    debt: amount,
    preferredEquity: amount,
    noncontrollingInterests: amount,
    otherLiabilities: amount,
    /** Capitalized corporate overhead not already included in property NOI. */
    corporateCostValue: amount,
  }),
  risk: excessReturnInputSchema.shape.risk,
  employeeEquity: excessReturnInputSchema.shape.employeeEquity,
  employeeEquityAvailableAt:
    excessReturnInputSchema.shape.employeeEquityAvailableAt,
  assumptions: reitAssumptionsSchema,
  scenarios: z
    .strictObject({
      bear: reitAssumptionsSchema,
      bull: reitAssumptionsSchema,
    })
    .nullable(),
  sensitivity: z
    .strictObject({
      terminalEquityBetas: z.array(engineDecimalSchema).min(1).max(11),
      terminalGrowthRates: z.array(engineDecimalSchema).min(1).max(11),
      capRates: z.array(engineDecimalSchema).min(1).max(11),
    })
    .nullable(),
});

export type ReitInput = z.infer<typeof reitInputSchema>;
export type ReitAssumptions = z.infer<typeof reitAssumptionsSchema>;

export function computeReitInputHash(input: ReitInput): string {
  return computeContentHash(reitInputSchema.parse(input));
}
