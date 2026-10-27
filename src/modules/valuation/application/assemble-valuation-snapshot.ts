import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type {
  ReturnClose,
  ReturnEvent,
} from "@/modules/metrics/domain/total-return";

import type { ReferenceDatasetReading } from "@/modules/reference-data/application/read-reference-dataset";

import {
  ZERO_DEBT_EVIDENCE_VERSION,
  ZERO_DEBT_FISCAL_YEARS,
} from "../domain/zero-debt-evidence";
import {
  consecutiveRevenueHistory,
  deriveAssumptions,
  DERIVED_ASSUMPTIONS_V2_VERSION,
  INDUSTRY_RETURN_FIELD,
  INDUSTRY_RETURNS_DATASET,
  type IndustryReturn,
} from "../domain/derived-assumptions";
import {
  CYCLE_METHODOLOGY_VERSION,
  NORMALIZED_FCFF_ENGINE_VERSION,
} from "../domain/cycle-normalization";
import { DECIMAL_POLICY } from "../domain/decimal-policy";
import {
  applyDerivedCycle,
  derivedCycleNormalization,
} from "../domain/derived-cycle";
import {
  deriveEmployeeEquity,
  EMPLOYEE_EQUITY_CLAIM_VERSION,
  EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION,
  employeeOptionMarketAt,
  employeeOptionsXbrlAt,
  sharesOutstandingAt,
  type EmployeeEquityDecision,
  type EmployeeOptionMarket,
} from "../domain/employee-equity-claim";
import { employeeEquityDocumentId } from "../domain/employee-equity";
import { deriveRigorLevel } from "../domain/rigor-level";
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
  /**
   * Opciones vivas, su strike y unidades no consolidadas del XBRL (`F6-16`):
   * el respaldo sin transcripción aceptada. Ausente es `[]`.
   */
  readonly employeeOptionFacts?: readonly ShareCountReading[];
  readonly prices: {
    readonly sourceId: string;
    readonly closes: readonly ReturnClose[];
    readonly events: readonly ReturnEvent[];
  };
  /**
   * La release de `damodaran.eva-us` visible al corte (`F6-10`), o `null`.
   * Sin ella el ROIC terminal cae al WACC terminal y lo nombra.
   */
  readonly industryReturns: ReferenceDatasetReading | null;
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

/** La fila de la industria de la corrida, si la release publica su ROC. */
function industryReturnAt(
  reading: ReferenceDatasetReading | null,
  industryKey: string,
): IndustryReturn | null {
  const value = reading?.rows.find((row) => row.key === industryKey)?.values[
    INDUSTRY_RETURN_FIELD
  ];

  if (reading === null || value === undefined || value === null) {
    return null;
  }

  return {
    datasetId: INDUSTRY_RETURNS_DATASET,
    releaseId: reading.release.releaseId,
    rowKey: industryKey,
    field: INDUSTRY_RETURN_FIELD,
    value,
    publishedLabel: reading.release.publishedLabel,
    availableAt: reading.release.availableAt,
  };
}

export function assembleValuationSnapshot(
  request: ValuationSnapshotRequest,
): ValuationSnapshotResult {
  const { assessment } = request;
  const { selection } = assessment;

  // `normalized_fcff` sólo con la historia de ciclo que derivó la evaluación
  // (`F6-18`, ADR 0059); los demás métodos todavía no tienen regla.
  const cycle = assessment.cycle?.status === "ready" ? assessment.cycle : null;

  if (
    selection.status !== "selected" ||
    (selection.recommendedMethod !== VALUATION_METHOD &&
      !(selection.recommendedMethod === "normalized_fcff" && cycle !== null))
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
    version: DERIVED_ASSUMPTIONS_V2_VERSION,
    industryReturn: industryReturnAt(
      request.industryReturns,
      costOfCapital.industryKey,
    ),
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

  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const asOf = valuationDate(request.prices.closes, knownAt);
  const shares = sharesOutstandingAt(request.shareCounts, { asOf, knownAt });

  if (shares === null) {
    return notAssembled("shares_outstanding_unavailable");
  }

  // Las opciones, en orden (`F6-16`, ADR 0055): la transcripción aceptada, el
  // XBRL de la misma presentación y, sin ninguno, no restarlas y decirlo.
  const stored = request.employeeEquity;
  const accepted =
    stored !== null &&
    stored.proposal.outcome === "accepted" &&
    stored.proposal.transcription !== null &&
    stored.proposal.respondedModel !== null
      ? stored
      : null;
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
      : (employeeOptionsXbrlAt(request.employeeOptionFacts ?? [], {
          fiscalYearEnd: baseFiscalYearEnd,
          knownAt,
          sourceId: request.fundamentalsSourceId,
        }) ?? {
          basis: "not_subtracted",
          version: EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION,
          fiscalYearEnd: baseFiscalYearEnd,
          reason: "no_transcription_or_xbrl",
        });
  const outstandingOptions =
    decision.basis === "ai_proposal"
      ? decision.transcription.optionsStatus === "outstanding"
      : decision.basis === "xbrl_same_10k" && decision.weightedStrike !== null;
  let market: EmployeeOptionMarket | null = null;

  if (outstandingOptions) {
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
  // La provenance de la deuda es la del primer componente que la receta sumó.
  const firstDebtFact = (
    normalization.debt.status === "resolved"
      ? normalization.debt.included.map(
          (entry) => balance.debt[entry.component],
        )
      : []
  ).find((fact): fact is NonNullable<typeof fact> => fact !== null);
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
      rigor:
        decision.basis === "not_subtracted"
          ? deriveRigorLevel(selection, assessment.completeness, {
              employeeOptionsNotSubtracted: true,
            })
          : assessment.rigor,
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
        `${DERIVED_ASSUMPTIONS_V2_VERSION}: no recipe separates non-operating assets; valued at zero and named.`,
      ),
      debt:
        normalization.debt.status === "resolved" && firstDebtFact !== undefined
          ? reported(atBase(normalization.debt.total, firstDebtFact))
          : normalization.debt.status === "zero_with_evidence"
            ? declaredAbsent(
                `${ZERO_DEBT_EVIDENCE_VERSION}: no borrowing or scheduled debt maturity in the last ${ZERO_DEBT_FISCAL_YEARS} fiscal years, and interest is absent or within the top rating band; valued at zero and named.`,
              )
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
        `${DERIVED_ASSUMPTIONS_V2_VERSION}: no recipe reads preferred or other senior claims; valued at zero and named.`,
      ),
      employeeOptions: employeeOptionsClaim(decision, derived, {
        currency: costOfCapital.currency,
        asOf,
        stored: accepted,
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
    scenarios: assumptions.scenarios,
  });

  if (cycle === null) {
    return { status: "assembled", input };
  }

  // La misma corrida con la regla de ciclo: el motor recalcula la
  // trayectoria y el check vuelve a aplicar la misma función.
  const cycleNormalization = derivedCycleNormalization({
    history: cycle.history,
    profileEvidence: assessment.evidence,
    employeeEquityAvailableAt: sharesOutstanding.availableAt,
  });
  const reshaped = applyDerivedCycle(input, {
    cycle: cycleNormalization,
    baseRevenue: input.baseRevenue.value,
    baseEbitAdjusted: input.normalization.base.ebitAdjusted,
  });

  return {
    status: "assembled",
    input: valuationInputSchema.parse({
      ...input,
      method: "normalized_fcff",
      engineVersion: NORMALIZED_FCFF_ENGINE_VERSION,
      methodologyVersion: CYCLE_METHODOLOGY_VERSION,
      cycleNormalization,
      periods: reshaped.periods,
      terminal: reshaped.terminal,
      scenarios: reshaped.scenarios,
    }),
  };
}

/** La claim `employeeOptions` del puente para cada base de la decisión. */
function employeeOptionsClaim(
  decision: EmployeeEquityDecision,
  derived: ReturnType<typeof deriveEmployeeEquity>,
  context: {
    readonly currency: string;
    readonly asOf: string;
    readonly stored: StoredEmployeeEquity | null;
  },
): BridgeItem {
  if (decision.basis === "not_subtracted") {
    return declaredAbsent(
      `${EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION}: no accepted transcription of the equity note and no option count and strike in the XBRL of the same filing; employee options are not subtracted, so the value per share is an upper bound.`,
    );
  }

  if (derived.options === null) {
    return declaredAbsent(
      decision.basis === "ai_proposal"
        ? "The accepted transcription of the equity note has no outstanding employee options."
        : "The XBRL of the same filing reports no outstanding employee options.",
    );
  }

  const provenance =
    decision.basis === "ai_proposal"
      ? {
          availableAt: context.stored!.evidence.documentAcceptedAt,
          sourceId: context.stored!.evidence.sourceId,
          sourceDocumentId: employeeEquityDocumentId(decision.proposalId),
          observationId: null,
        }
      : {
          availableAt: [
            decision.optionsOutstanding.availableAt,
            decision.weightedStrike!.availableAt,
          ].sort((left, right) => right.localeCompare(left))[0]!,
          sourceId: decision.optionsOutstanding.sourceId,
          sourceDocumentId: decision.sourceDocumentId,
          observationId: decision.optionsOutstanding.observationId,
        };

  return reported({
    value: derived.options.totalValue,
    currency: context.currency,
    unit: "monetary",
    asOf: context.asOf,
    ...provenance,
    qualityFlags: [],
  });
}
