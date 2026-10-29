import { tenKVisibleText } from "@/modules/fundamentals/domain/sec-10k-sections";
import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import { formatDecimal, parseDecimal } from "./decimal-policy";
import type { MonetaryFact } from "./valuation-facts";

export const GROWTH_TAX_EVIDENCE_VERSION = "growth-tax-evidence-1.0.0";

export type GrowthTaxEvidence = {
  readonly version: typeof GROWTH_TAX_EVIDENCE_VERSION;
  readonly lossCarryforward: MonetaryFact;
  readonly lossOffsetLimit: string;
  readonly lossPolicyRationale: string;
};

export type GrowthTaxReading =
  | { readonly status: "ready"; readonly evidence: GrowthTaxEvidence }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "filing_year_mismatch"
        | "tax_note_missing"
        | "jurisdictions_not_reconciled"
        | "tax_pool_not_reconciled";
    };

/**
 * Intentionally narrow: a single, indefinite U.S. federal NOL pool with an
 * explicit annual offset limit. Any jurisdiction mix or expiry refuses.
 */
export function deriveGrowthTaxEvidence(input: {
  readonly html: string;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
}): GrowthTaxReading {
  if (input.report.reportDate !== input.fiscalYearEnd)
    return { status: "unavailable", reason: "filing_year_mismatch" };
  const text = tenKVisibleText(input.html)
    .replace(/\s+/gu, " ")
    .replace(/[’‘]/gu, "'");
  const mentions = [...text.matchAll(/net operating loss carryforwards?/giu)];
  if (mentions.length === 0)
    return { status: "unavailable", reason: "tax_note_missing" };
  const contexts = mentions.map((mention) =>
    text.slice(Math.max(0, mention.index - 600), mention.index + 900),
  );
  if (
    contexts.some((context) =>
      /\b(?:malaysia|foreign|state|jurisdictions?|countries|international)\b/iu.test(
        context,
      ),
    )
  )
    return { status: "unavailable", reason: "jurisdictions_not_reconciled" };
  if (mentions.length !== 1)
    return { status: "unavailable", reason: "tax_pool_not_reconciled" };

  const context = contexts[0]!;
  const amount = context.match(
    /u\.?s\.? federal net operating loss carryforwards? (?:of|total(?:ed|ing)) \$([\d,]+(?:\.\d+)?) (million|billion)\b/iu,
  );
  const offset = context.match(
    /(?:offset|deduct|utili[sz]e) (?:up to )?([\d.]+)% of (?:future )?taxable income/iu,
  );
  if (
    amount === null ||
    offset === null ||
    !/\bindefinite(?:ly)?\b/iu.test(context) ||
    /\b(?:expir(?:e|es|ing|ation)|limited by section 382)\b/iu.test(context)
  )
    return { status: "unavailable", reason: "tax_pool_not_reconciled" };
  const cap = parseDecimal(offset[1]!, "lossOffsetLimit").dividedBy(100);
  if (cap.lt(0) || cap.gt(1))
    return { status: "unavailable", reason: "tax_pool_not_reconciled" };
  const multiplier = amount[2]!.toLowerCase() === "billion" ? 1e9 : 1e6;
  const value = parseDecimal(amount[1]!.replaceAll(",", ""), "taxLoss").times(
    multiplier,
  );
  if (!value.gt(0))
    return { status: "unavailable", reason: "tax_pool_not_reconciled" };

  return {
    status: "ready",
    evidence: {
      version: GROWTH_TAX_EVIDENCE_VERSION,
      lossCarryforward: {
        value: formatDecimal(value, "taxLoss"),
        currency: "USD",
        unit: "monetary",
        asOf: input.fiscalYearEnd,
        availableAt: input.report.acceptedAt,
        sourceId: "sec-edgar",
        sourceDocumentId: input.report.accessionNumber,
        observationId: null,
        qualityFlags: [],
      },
      lossOffsetLimit: formatDecimal(cap, "lossOffsetLimit"),
      lossPolicyRationale:
        "growth-tax-evidence-1.0.0: one indefinite U.S. federal NOL pool with an explicit annual taxable-income offset cap in the cited 10-K.",
    },
  };
}
