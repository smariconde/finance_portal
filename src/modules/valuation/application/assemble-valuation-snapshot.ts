import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type {
  ReturnClose,
  ReturnEvent,
} from "@/modules/metrics/domain/total-return";

import {
  consecutiveRevenueHistory,
  deriveAssumptions,
  DERIVED_ASSUMPTIONS_VERSION,
} from "../domain/derived-assumptions";
import { DECIMAL_POLICY } from "../domain/decimal-policy";
import {
  deriveEmployeeEquity,
  EMPLOYEE_EQUITY_CLAIM_VERSION,
  employeeOptionMarketAt,
  sharesOutstandingAt,
  type EmployeeEquityDecision,
  type EmployeeOptionMarket,
} from "../domain/employee-equity-claim";
import { employeeEquityDocumentId } from "../domain/employee-equity";
import {
  ENGINE_VERSION,
  METHODOLOGY_VERSION,
  VALUATION_METHOD,
  valuationInputSchema,
  type BridgeItem,
  type MonetaryFact,
  type ValuationInput,
} from "../domain/valuation-input";
import type { ValuationSnapshotGap } from "../domain/valuation-job";
import type { CompanyAssessment } from "./assess-company";
import { seriesFact } from "./assess-company";
import type { StoredEmployeeEquity } from "./employee-equity-repository";

/**
 * Arma el snapshot de una corrida `fcff_base` desde lo guardado (`F6-07`,
 * [ADR 0046](../../../../docs/architecture/adr/0046-derived-valuation-assumptions.md)).
 *
 * No lee repositorios, no abre la red y no llama al modelo: recibe la
 * evaluación de la Fase 3, la transcripción aceptada de opciones, las acciones
 * de la carátula y la serie de precios ya leídas al corte. Lo que no alcanza
 * para un snapshot se nombra; lo que alcanza pero no pasa un check se valúa
 * igual, porque un rechazo con motivo también es una corrida.
 */
export const VALUATION_SNAPSHOT_ASSEMBLY_VERSION = "valuation-snapshot-1.0.0";

export type SnapshotGap = ValuationSnapshotGap;

export type ShareCountReading = {
  readonly concept: string;
  readonly asOf: string;
  readonly availableAt: string;
  readonly value: string;
  readonly observationId: string;
  readonly sourceDocumentId: string | null;
};

export type ValuationSnapshotRequest = {
  readonly subject: {
    readonly legalEntityId: string;
    readonly securityId: string | null;
    readonly listingId: string | null;
  };
  /** Corte de conocimiento del job: el `as_known` de todo lo leído. */
  readonly query: PointInTimeQuery;
  readonly assessment: CompanyAssessment;
  readonly fundamentalsSourceId: string;
  /** La transcripción aceptada que existía al corte, o `null`. */
  readonly employeeEquity: StoredEmployeeEquity | null;
  readonly shareCounts: readonly ShareCountReading[];
  readonly prices: {
    readonly sourceId: string;
    readonly closes: readonly ReturnClose[];
    readonly events: readonly ReturnEvent[];
  };
};

export type ValuationSnapshotResult =
  | { readonly status: "assembled"; readonly input: ValuationInput }
  | { readonly status: "not_assembled"; readonly gap: SnapshotGap };

const notAssembled = (gap: SnapshotGap): ValuationSnapshotResult => ({
  status: "not_assembled",
  gap,
});

const declaredAbsent = (rationale: string): BridgeItem => ({
  status: "declared_absent",
  amount: null,
  rationale,
});

const missing: BridgeItem = {
  status: "missing",
  amount: null,
  rationale: null,
};

const reported = (amount: MonetaryFact): BridgeItem => ({
  status: "reported",
  amount,
  rationale: null,
});

/**
 * La fecha de valuación: el último cierre guardado que el corte admite. Sin
 * serie, el día del corte; con opciones vivas eso no alcanza y el mercado lo
 * nombra.
 */
function valuationDate(
  closes: readonly ReturnClose[],
  knownAt: string,
): string {
  const day = knownAt.slice(0, 10);
  const last = closes
    .map((close) => close.marketDate)
    .filter((date) => date <= day)
    .sort()
    .at(-1);

  return last ?? day;
}

export function assembleValuationSnapshot(
  request: ValuationSnapshotRequest,
): ValuationSnapshotResult {
  const { assessment } = request;
  const { selection } = assessment;

  if (
    selection.status !== "selected" ||
    selection.recommendedMethod !== VALUATION_METHOD
  ) {
    return notAssembled("method_not_derived");
  }

  if (request.subject.securityId === null) {
    return notAssembled("security_missing");
  }

  if (assessment.costOfCapital.status !== "computed") {
    return notAssembled("cost_of_capital_unavailable");
  }

  const { costOfCapital } = assessment.costOfCapital;
  const { capitalization, normalization } = assessment;
  const series = assessment.fundamentals.series;
  const revenueItem = series?.fiscalYears[0]?.items.revenue;

  if (
    capitalization === null ||
    normalization === null ||
    series === null ||
    revenueItem === undefined
  ) {
    return notAssembled("normalization_unavailable");
  }

  const baseRevenue = seriesFact(revenueItem, request.fundamentalsSourceId);
  const baseFiscalYearEnd = normalization.facts.baseFiscalYearEnd;
  const derivation = {
    version: DERIVED_ASSUMPTIONS_VERSION,
    revenueHistory: consecutiveRevenueHistory(
      series.fiscalYears.flatMap((year) =>
        year.items.revenue === undefined
          ? []
          : [
              {
                fiscalYearEnd: year.fiscalYearEnd,
                value: year.items.revenue.value,
              },
            ],
      ),
      baseFiscalYearEnd,
    ),
  } as const;
  const assumptions = deriveAssumptions({
    derivation,
    baseFiscalYearEnd,
    normalization,
    costOfCapital,
  });

  if (assumptions.status === "unavailable") {
    return notAssembled(assumptions.reason);
  }

  const stored = request.employeeEquity;

  if (
    stored === null ||
    stored.proposal.outcome !== "accepted" ||
    stored.proposal.transcription === null ||
    stored.proposal.respondedModel === null
  ) {
    return notAssembled("employee_equity_not_proposed");
  }

  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const asOf = valuationDate(request.prices.closes, knownAt);
  const shares = sharesOutstandingAt(request.shareCounts, { asOf, knownAt });

  if (shares === null) {
    return notAssembled("shares_outstanding_unavailable");
  }

  const decision: EmployeeEquityDecision = {
    basis: "ai_proposal",
    proposalId: stored.proposal.proposalId,
    accessionNumber: stored.proposal.accessionNumber,
    fiscalYearEnd: stored.proposal.fiscalYearEnd,
    taskVersion: stored.proposal.taskVersion,
    promptVersion: stored.proposal.promptVersion,
    policyVersion: stored.proposal.policyVersion,
    extractVersion: stored.proposal.extractVersion,
    respondedModel: stored.proposal.respondedModel,
    evidenceSha256: stored.evidence.sha256,
    transcription: stored.proposal.transcription,
  };
  let market: EmployeeOptionMarket | null = null;

  if (decision.transcription.optionsStatus === "outstanding") {
    const reading = employeeOptionMarketAt({
      subjectId: request.subject.securityId,
      asOf,
      sourceId: request.prices.sourceId,
      closes: request.prices.closes,
      events: request.prices.events,
    });

    if ("reason" in reading) {
      return notAssembled("market_unavailable");
    }

    market = reading;
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
  const derived = deriveEmployeeEquity({
    decision,
    sharesOutstanding,
    market,
    riskFree: costOfCapital.derived.riskFree,
  });
  const balance = normalization.facts.balance;
  const atBase = (value: string, provenance: MonetaryFact): MonetaryFact => ({
    ...provenance,
    value,
    asOf: baseFiscalYearEnd,
  });
  const firstDebtFact = Object.values(balance.debt).find(
    (fact): fact is NonNullable<typeof fact> => fact !== null,
  );
  const leases = capitalization.leases.result;
  const leaseFact =
    capitalization.leases.totalLiability ??
    capitalization.leases.noncurrentLiability;

  const input = valuationInputSchema.parse({
    subject: {
      legalEntityId: request.subject.legalEntityId,
      securityId: request.subject.securityId,
      listingId: request.subject.listingId,
      depositaryProgramId: null,
    },
    asOf,
    currency: costOfCapital.currency,
    knowledge: request.query,
    assetProfile: selection.assetProfile,
    assessment: {
      selection,
      completeness: assessment.completeness,
      rigor: assessment.rigor,
    },
    costOfCapital,
    failureRisk: assessment.failureRisk,
    qualitativeDecisions: assessment.qualitativeDecisions,
    capitalization,
    normalization,
    method: VALUATION_METHOD,
    engineVersion: ENGINE_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    decimalPolicy: DECIMAL_POLICY,
    baseRevenue,
    periods: assumptions.periods,
    reinvestmentConventionBridge: null,
    terminal: assumptions.terminal,
    bridge: {
      excessCash:
        normalization.excessCash.status === "resolved" && balance.cash !== null
          ? reported(atBase(normalization.excessCash.total, balance.cash))
          : missing,
      nonOperatingAssets: declaredAbsent(
        `${DERIVED_ASSUMPTIONS_VERSION}: no recipe separates non-operating assets; valued at zero and named.`,
      ),
      debt:
        normalization.debt.status === "resolved" && firstDebtFact !== undefined
          ? reported(atBase(normalization.debt.total, firstDebtFact))
          : missing,
      leaseDebt:
        leases.status === "capitalized" && leaseFact !== null
          ? reported(atBase(leases.leaseDebt, leaseFact))
          : leases.status === "not_capitalized" &&
              leases.reason === "lease_liability_missing"
            ? declaredAbsent(
                "No operating lease liability is reported in the base-year balance sheet.",
              )
            : missing,
      minorityInterest:
        balance.minorityInterest !== null
          ? reported(balance.minorityInterest)
          : normalization.investedCapital.status === "resolved" &&
              normalization.investedCapital.minorityInterestBasis ===
                "included_in_equity"
            ? missing
            : declaredAbsent(
                "No noncontrolling interest is reported in the base-year balance sheet.",
              ),
      otherClaims: declaredAbsent(
        `${DERIVED_ASSUMPTIONS_VERSION}: no recipe reads preferred or other senior claims; valued at zero and named.`,
      ),
      employeeOptions:
        derived.options === null
          ? declaredAbsent(
              "The accepted transcription of the equity note has no outstanding employee options.",
            )
          : reported({
              value: derived.options.totalValue,
              currency: costOfCapital.currency,
              unit: "monetary",
              asOf,
              availableAt: stored.evidence.documentAcceptedAt,
              sourceId: stored.evidence.sourceId,
              sourceDocumentId: employeeEquityDocumentId(
                stored.proposal.proposalId,
              ),
              observationId: null,
              qualityFlags: [],
            }),
    },
    employeeEquity: {
      version: EMPLOYEE_EQUITY_CLAIM_VERSION,
      decision,
      sharesOutstanding,
      market,
      derived,
    },
    sensitivity: assumptions.sensitivity,
    derivedAssumptions: derivation,
    scenarios: null,
  });

  return { status: "assembled", input };
}
