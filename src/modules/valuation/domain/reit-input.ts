import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { engineDecimalSchema } from "./decimal-policy";
import {
  excessReturnInputSchema,
  financialRateFactSchema,
} from "./excess-return-input";
import { monetaryFactSchema } from "./valuation-facts";
import {
  reitAffoOutputSchema,
  REIT_AFFO_POLICY_VERSION,
  REIT_AFFO_PROMPT_VERSION,
  REIT_AFFO_TASK_VERSION,
} from "./reit-affo-task";

export const REIT_ENGINE_VERSION = "affo-nav-1.0.0";
export const REIT_METHODOLOGY_VERSION = "reit-equity-1.0.0";
/**
 * `affo-nav-1.1.0` (ADR 0064): AFFO desde el XBRL, con los componentes que la
 * empresa no etiquetó declarados como no ajustados, y NAV opcional —sin NOI y
 * cap rate fechados queda declarado ausente, nunca estimado—. Las corridas
 * `1.0.0` conservan su contrato y sus hashes.
 */
export const DERIVED_REIT_ENGINE_VERSION = "affo-nav-1.1.0";
export const DERIVED_REIT_METHODOLOGY_VERSION = "reit-equity-1.1.0";
export const DERIVED_REIT_VERSION = "derived-reit-1.0.0";

/** Componentes que pueden faltar en el XBRL; resultado y depreciación no. */
export const REIT_OPTIONAL_AFFO_COMPONENTS = [
  "propertySaleGains",
  "realEstateImpairments",
  "jointVentureAdjustment",
  "recurringCapex",
  "straightLineRent",
] as const;
export type ReitOptionalAffoComponent =
  (typeof REIT_OPTIONAL_AFFO_COMPONENTS)[number];

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
  /**
   * Forward twelve-month NOI, before financing; cap rate uses the same basis.
   * `null` only under `affo-nav-1.1.0`: the NAV is declared absent.
   */
  nav: z
    .strictObject({
      forwardNoi: engineDecimalSchema,
      capRate: engineDecimalSchema,
      rationale,
    })
    .nullable(),
});

/**
 * `derived-reit-1.0.0`: what the job read to build AFFO and the assumptions,
 * frozen so `reit_assumptions_derived_recomputed` rebuilds them offline.
 */
export const derivedReitSchema = z.strictObject({
  version: z.literal(DERIVED_REIT_VERSION),
  /** The concept that supplied each AFFO component, or why none did. */
  affoBasis: z.strictObject({
    commonNetIncome: z.string().min(1).max(256),
    realEstateDepreciation: z.string().min(1).max(256),
    propertySaleGains: z.string().min(1).max(256).nullable(),
    realEstateImpairments: z.string().min(1).max(256).nullable(),
    jointVentureAdjustment: z.null(),
    recurringCapex: z.string().min(1).max(256).nullable(),
    straightLineRent: z.string().min(1).max(256).nullable(),
  }),
  /** Real estate held over total assets at the base close: the property basis. */
  propertyShare: z.strictObject({
    realEstatePropertyNet: monetaryFactSchema,
    assets: monetaryFactSchema,
    share: engineDecimalSchema,
  }),
  /** Most recent first; the trend sets the starting AFFO growth. */
  revenueHistory: z
    .array(
      z.strictObject({
        fiscalYearEnd: z.iso.date(),
        value: engineDecimalSchema,
      }),
    )
    .min(3)
    .max(10),
  commonEquity: monetaryFactSchema,
  commonEquityBasis: z.enum([
    "common_equity",
    "equity_less_preferred",
    "equity_without_preferred_tagged",
  ]),
  /** The published industry beta the cost of equity starts from. */
  equityBeta: financialRateFactSchema,
});
export type DerivedReit = z.infer<typeof derivedReitSchema>;

/** Equity property REITs only. Mortgage REITs need a separate asset model. */
export const reitInputSchema = z
  .strictObject({
    method: z.literal("affo_nav"),
    engineVersion: z.enum([REIT_ENGINE_VERSION, DERIVED_REIT_ENGINE_VERSION]),
    methodologyVersion: z.enum([
      REIT_METHODOLOGY_VERSION,
      DERIVED_REIT_METHODOLOGY_VERSION,
    ]),
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
    /** Accepted 10-K transcription and its quotes are frozen for offline replay. */
    derivedAffo: z
      .strictObject({
        taskVersion: z.literal(REIT_AFFO_TASK_VERSION),
        promptVersion: z.literal(REIT_AFFO_PROMPT_VERSION),
        policyVersion: z.literal(REIT_AFFO_POLICY_VERSION),
        sourceDocumentId: z.string().trim().min(1).max(256),
        acceptedAt: z.iso.datetime({ offset: true }),
        evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        proposal: reitAffoOutputSchema,
      })
      .optional(),
    /** `affo-nav-1.1.0` only: the XBRL reading and the derivation rule. */
    derivedReit: derivedReitSchema.optional(),
    /**
     * Consolidated NOI and claims: no proportionate/consolidated mixing.
     * `null` only under `affo-nav-1.1.0`.
     */
    nav: z
      .strictObject({
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
      })
      .nullable(),
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
  })
  .superRefine((input, context) => {
    const derived = input.engineVersion === DERIVED_REIT_ENGINE_VERSION;
    if (
      derived !==
      (input.methodologyVersion === DERIVED_REIT_METHODOLOGY_VERSION)
    )
      context.addIssue({
        code: "custom",
        path: ["methodologyVersion"],
        message: "Engine and methodology versions move together.",
      });
    if (derived !== (input.derivedReit !== undefined))
      context.addIssue({
        code: "custom",
        path: ["derivedReit"],
        message: "Only affo-nav-1.1.0 carries the XBRL derivation.",
      });
    const navAbsent =
      input.nav === null ||
      input.assumptions.nav === null ||
      input.scenarios?.bear.nav === null ||
      input.scenarios?.bull.nav === null;
    if (
      navAbsent &&
      (!derived ||
        input.nav !== null ||
        input.assumptions.nav !== null ||
        input.scenarios !== null ||
        (input.sensitivity !== null && input.sensitivity.capRates.length > 0))
    )
      context.addIssue({
        code: "custom",
        path: ["nav"],
        message:
          "NAV may be absent only under affo-nav-1.1.0, and then everywhere.",
      });
  });

export type ReitInput = z.infer<typeof reitInputSchema>;
export type ReitAssumptions = z.infer<typeof reitAssumptionsSchema>;

export function computeReitInputHash(input: ReitInput): string {
  return computeContentHash(reitInputSchema.parse(input));
}
