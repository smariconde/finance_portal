import type { ValuationSnapshotRequest } from "./assemble-valuation-snapshot";
import type { StoredFinancialDeclaration } from "../domain/financial-declaration";
import type { ValuationSnapshotGap } from "../domain/valuation-job";
import {
  sharesOutstandingAt,
  employeeOptionsXbrlAt,
  employeeOptionMarketAt,
  deriveEmployeeEquity,
  EMPLOYEE_EQUITY_CLAIM_VERSION,
  type EmployeeEquityDecision,
  type EmployeeOptionMarket,
} from "../domain/employee-equity-claim";
import {
  DECIMAL_POLICY,
  ONE,
  ZERO,
  divide,
  parseDecimal,
} from "../domain/decimal-policy";
import {
  DERIVED_EXCESS_RETURN_ENGINE_VERSION,
  DERIVED_EXCESS_RETURN_METHODOLOGY_VERSION,
  excessReturnInputSchema,
  type ExcessReturnInput,
} from "../domain/excess-return-input";
import { DERIVED_FINANCIAL_EQUITY_VERSION } from "../domain/derived-financial-equity";

export const FINANCIAL_SNAPSHOT_ASSEMBLY_VERSION = "financial-snapshot-1.0.0";

export type FinancialSnapshotResult =
  | { readonly status: "assembled"; readonly input: ExcessReturnInput }
  | { readonly status: "not_assembled"; readonly gap: ValuationSnapshotGap };

export function assembleFinancialSnapshot(
  request: ValuationSnapshotRequest & {
    readonly declaration: StoredFinancialDeclaration | null;
  },
): FinancialSnapshotResult {
  const { assessment } = request;
  if (
    assessment.selection.status !== "selected" ||
    assessment.selection.recommendedMethod !== "excess_return"
  )
    return { status: "not_assembled", gap: "method_not_derived" };
  if (request.subject.securityId === null)
    return { status: "not_assembled", gap: "security_missing" };
  const equity = assessment.financialEquity;
  const risk = assessment.financialRisk;
  if (equity?.status !== "ready")
    return { status: "not_assembled", gap: "financial_base_unavailable" };
  if (risk?.status !== "ready")
    return { status: "not_assembled", gap: "cost_of_capital_unavailable" };
  const declaration = request.declaration;
  if (
    declaration === null ||
    declaration.fiscalYearEnd !== equity.fiscalYearEnd
  )
    return { status: "not_assembled", gap: "financial_declaration_missing" };

  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const asOf = request.prices.closes
    .map((close) => close.marketDate)
    .filter((date) => date <= knownAt.slice(0, 10))
    .sort()
    .at(-1);
  if (asOf === undefined)
    return { status: "not_assembled", gap: "market_unavailable" };
  const ageDays = (date: string) =>
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    86_400_000;
  if (ageDays(equity.fiscalYearEnd) < 0 || ageDays(equity.fiscalYearEnd) > 540)
    return { status: "not_assembled", gap: "financial_base_stale" };
  const shares = sharesOutstandingAt(request.shareCounts, { asOf, knownAt });
  if (shares === null || ageDays(shares.asOf) > 180)
    return { status: "not_assembled", gap: "shares_outstanding_unavailable" };
  const accepted =
    request.employeeEquity?.proposal.outcome === "accepted" &&
    request.employeeEquity.proposal.fiscalYearEnd === equity.fiscalYearEnd &&
    request.employeeEquity.proposal.transcription !== null &&
    request.employeeEquity.proposal.respondedModel !== null
      ? request.employeeEquity
      : null;
  const xbrl = employeeOptionsXbrlAt(request.employeeOptionFacts ?? [], {
    fiscalYearEnd: equity.fiscalYearEnd,
    knownAt,
    sourceId: request.fundamentalsSourceId,
  });
  if (accepted === null && xbrl === null)
    return { status: "not_assembled", gap: "employee_equity_not_proposed" };
  const decision: EmployeeEquityDecision =
    accepted !== null
      ? {
          basis: "ai_proposal",
          proposalId: accepted.proposal.proposalId,
          accessionNumber: accepted.proposal.accessionNumber,
          fiscalYearEnd: accepted.proposal.fiscalYearEnd,
          taskVersion: accepted.proposal.taskVersion,
          promptVersion: accepted.proposal.promptVersion,
          policyVersion: accepted.proposal.policyVersion,
          extractVersion: accepted.proposal.extractVersion,
          respondedModel: accepted.proposal.respondedModel!,
          evidenceSha256: accepted.evidence.sha256,
          transcription: accepted.proposal.transcription!,
        }
      : xbrl!;
  const outstanding =
    decision.basis === "ai_proposal"
      ? decision.transcription.optionsStatus === "outstanding"
      : decision.weightedStrike !== null;
  let market: EmployeeOptionMarket | null = null;
  if (outstanding) {
    const result = employeeOptionMarketAt({
      subjectId: request.subject.securityId,
      asOf,
      sourceId: request.prices.sourceId,
      closes: request.prices.closes,
      events: request.prices.events,
    });
    if ("reason" in result)
      return { status: "not_assembled", gap: "market_unavailable" };
    market = result;
  }
  const sharesOutstanding = {
    asOf: shares.asOf,
    availableAt: shares.availableAt,
    sourceId: request.fundamentalsSourceId,
    sourceDocumentId: shares.sourceDocumentId,
    observationId: shares.observationId,
    qualityFlags: [],
    value: shares.value,
    unit: "shares" as const,
  };
  const riskFree = risk.risk.riskFree!;
  const employeeEquity = {
    version: EMPLOYEE_EQUITY_CLAIM_VERSION,
    decision,
    sharesOutstanding,
    market,
    derived: deriveEmployeeEquity({
      decision,
      sharesOutstanding,
      market,
      riskFree: riskFree.value,
    }),
  };
  const roe = parseDecimal(equity.roe, "roe");
  const beta = parseDecimal(risk.equityBeta.value, "beta");
  const ke = parseDecimal(riskFree.value, "riskFree")
    .plus(parseDecimal(risk.risk.matureErp!.value, "erp"))
    .plus(parseDecimal(risk.risk.countryRiskPremium!.value, "crp"));
  if (
    !roe.gt(ZERO) ||
    !ke.gt(ZERO) ||
    parseDecimal(riskFree.value, "riskFree").lt(ZERO)
  )
    return { status: "not_assembled", gap: "financial_base_unavailable" };
  const periods = Array.from({ length: 10 }, (_, index) => {
    const fraction = divide(
      parseDecimal(String(index + 1), "year"),
      parseDecimal("10", "horizon"),
      "horizon",
    );
    return {
      roe: roe.plus(ke.minus(roe).times(fraction)).toString(),
      payout: declaration.payout,
      equityBeta: beta.plus(ONE.minus(beta).times(fraction)).toString(),
    };
  });
  // The first explicit year uses the measured ROE and the published beta.
  periods[0] = {
    ...periods[0]!,
    roe: equity.roe,
    equityBeta: risk.equityBeta.value,
  };
  const terminalGrowth = parseDecimal(riskFree.value, "riskFree").lt(ke)
    ? riskFree.value
    : "0";
  const input = excessReturnInputSchema.parse({
    method: "excess_return",
    engineVersion: DERIVED_EXCESS_RETURN_ENGINE_VERSION,
    methodologyVersion: DERIVED_EXCESS_RETURN_METHODOLOGY_VERSION,
    decimalPolicy: DECIMAL_POLICY,
    subject: {
      ...request.subject,
      securityId: request.subject.securityId,
      depositaryProgramId: null,
    },
    asOf,
    currency: equity.commonBookEquity.currency,
    knowledge: request.query,
    assetProfile: assessment.selection.assetProfile,
    profileEvidence: assessment.evidence,
    commonBookEquity: equity.commonBookEquity,
    derivedFinancial: {
      version: DERIVED_FINANCIAL_EQUITY_VERSION,
      commonIncome: equity.commonIncome,
      priorBook: equity.priorBook,
      roe: equity.roe,
      equityBeta: risk.equityBeta,
      declarationId: declaration.declarationId,
      declarationAvailableAt: declaration.availableAt,
    },
    risk: risk.risk,
    employeeEquity,
    employeeEquityAvailableAt:
      accepted?.proposal.proposedAt ?? xbrl!.optionsOutstanding.availableAt,
    financialReview: {
      regulatoryCapital: `${declaration.regulatoryCapital} [${declaration.sourceDocumentId}]`,
      assetQuality: `${declaration.assetQuality} [${declaration.sourceDocumentId}]`,
      cleanSurplus: `${declaration.cleanSurplus} [${declaration.sourceDocumentId}]`,
    },
    assumptions: {
      rationale: `Ten-year convergence of reported common ROE to equity cost; owner payout ${declaration.payout}. ${declaration.rationale}`,
      periods,
      terminal: { roe: ke.toString(), growth: terminalGrowth, equityBeta: "1" },
    },
    scenarios: null,
    sensitivity: null,
  });
  return { status: "assembled", input };
}
