import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import type {
  ReturnClose,
  ReturnEvent,
} from "@/modules/metrics/domain/total-return";

import {
  noncontrollingInterestRationale,
  type NoncontrollingInterestEvidence,
} from "../domain/noncontrolling-interest-evidence";
import type { ReferenceDatasetReading } from "@/modules/reference-data/application/read-reference-dataset";

import { ZERO_DEBT_FISCAL_YEARS } from "../domain/zero-debt-evidence";
import {
  consecutiveRevenueHistory,
  deriveAssumptions,
  DERIVED_ASSUMPTIONS_V2_VERSION,
  DERIVED_ASSUMPTIONS_V3_VERSION,
  selectConsensusRevenue,
  INDUSTRY_CAPITAL_DATASET,
  INDUSTRY_RETURN_FIELD,
  INDUSTRY_RETURNS_DATASET,
  INDUSTRY_SALES_TO_CAPITAL_FIELD,
  ownSalesToCapitalOf,
  SALES_TO_CAPITAL_RULE_VERSION,
  type DerivedAssumptions,
  type IndustryReturn,
  type IndustrySalesToCapital,
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
import { flowOf, ttmFlowFact } from "../domain/ttm-base-period";
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
  /** `null`: la suma de clases de la carátula (`F6-32`) no tiene observación. */
  readonly observationId: string | null;
  readonly sourceDocumentId: string | null;
  /** La regla que armó el conteo cuando no es una observación. */
  readonly qualityFlags?: readonly string[];
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
  readonly employeeOptionFacts?: readonly (ShareCountReading & {
    readonly observationId: string;
  })[];
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
  /**
   * La release de `damodaran.capex-us` visible al corte (`F6-31`). Sólo se usa
   * cuando la ventas sobre capital propia no es positiva.
   */
  readonly industryCapital?: ReferenceDatasetReading | null;
  /** Builds common FCFF inputs for the separate growth assembler. */
  readonly growthFoundation?: boolean;
  /**
   * Evidencia de no controlantes en cero (`F6-49`) cuando el patrimonio sólo se
   * publica incluyéndolos: el estado de patrimonio del filing del cierre del
   * balance. Sin ella el reclamo queda `missing`.
   */
  readonly noncontrollingInterest?:
    | NoncontrollingInterestEvidence
    | { readonly status: "unavailable"; readonly reason: string }
    | null;
  /**
   * El consenso de ventas vigente al corte (`F6-39`, ADR 0085): los ejercicios
   * no retirados y la última captura visible. Sólo lo lee `fcff_base`; sin él
   * la derivación es `2.0.0`.
   */
  readonly consensus?: {
    readonly years: readonly {
      readonly periodEnd: string;
      readonly revenueAverage: string | null;
      readonly revenueLow: string | null;
      readonly revenueHigh: string | null;
      readonly analystCount: number | null;
      readonly availableAt: string;
    }[];
    readonly capturedAt: string | null;
  };
};

export type ValuationSnapshotResult =
  | { readonly status: "assembled"; readonly input: ValuationInput }
  | { readonly status: "not_assembled"; readonly gap: SnapshotGap };

/** Un hecho con concepto como hecho monetario: el puente no lo lleva. */
function withoutConcept(
  fact: MonetaryFact & { concept?: string },
): MonetaryFact {
  const { concept: _concept, ...rest } = fact;
  void _concept;
  return rest;
}

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

/** La ventas sobre capital de la industria de la corrida, si la release la publica. */
function industrySalesToCapitalAt(
  reading: ReferenceDatasetReading | null,
  industryKey: string,
): IndustrySalesToCapital | null {
  const value = reading?.rows.find((row) => row.key === industryKey)?.values[
    INDUSTRY_SALES_TO_CAPITAL_FIELD
  ];

  if (reading === null || value === undefined || value === null) {
    return null;
  }

  return {
    rule: SALES_TO_CAPITAL_RULE_VERSION,
    datasetId: INDUSTRY_CAPITAL_DATASET,
    releaseId: reading.release.releaseId,
    rowKey: industryKey,
    field: INDUSTRY_SALES_TO_CAPITAL_FIELD,
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

  const growthFoundation =
    request.growthFoundation === true &&
    (selection.recommendedMethod === "fcff_three_stage" ||
      selection.recommendedMethod === "revenue_margin_survival");
  if (
    (!growthFoundation && selection.status !== "selected") ||
    (!growthFoundation &&
      selection.recommendedMethod !== VALUATION_METHOD &&
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

  // Año base TTM (`F6-24`, ADR 0081): las ventas son las del TTM y los
  // períodos se cuentan desde el 10-Q; la historia, las opciones y lo que se
  // lee por ejercicio siguen en el cierre del 10-K.
  const basePeriod = assessment.basePeriod ?? null;
  const ttm = basePeriod?.basis === "ttm" ? basePeriod : null;
  const revenueFlow = ttm === null ? null : flowOf(ttm, "revenue");
  const baseRevenue: MonetaryFact =
    ttm === null || revenueFlow === null
      ? seriesFact(revenueItem, request.fundamentalsSourceId)
      : withoutConcept(ttmFlowFact(revenueFlow, ttm.periodEnd));
  const baseFiscalYearEnd = normalization.facts.baseFiscalYearEnd;
  const lastFiscalYearEnd = ttm?.fiscalYearEnd ?? baseFiscalYearEnd;
  const balanceAsOf =
    normalization.facts.basePeriod?.balanceAsOf ?? baseFiscalYearEnd;
  const leasesAsOf = capitalization.basePeriod?.leasesAsOf ?? baseFiscalYearEnd;
  const industrySalesToCapital =
    ownSalesToCapitalOf(normalization) === null
      ? industrySalesToCapitalAt(
          request.industryCapital ?? null,
          costOfCapital.industryKey,
        )
      : null;
  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const asOf = valuationDate(request.prices.closes, knownAt);
  const fcffBase =
    !growthFoundation &&
    cycle === null &&
    selection.recommendedMethod === VALUATION_METHOD;
  const measured = {
    industryReturn: industryReturnAt(
      request.industryReturns,
      costOfCapital.industryKey,
    ),
    ...(industrySalesToCapital === null ? {} : { industrySalesToCapital }),
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
      lastFiscalYearEnd,
    ),
  } as const;
  // `3.0.0` sólo en `fcff_base` (ADR 0085): las cíclicas y el camino de
  // crecimiento reemplazan el crecimiento y siguen en `2.0.0`.
  const derivation: DerivedAssumptions =
    fcffBase && request.consensus !== undefined
      ? {
          version: DERIVED_ASSUMPTIONS_V3_VERSION,
          ...measured,
          consensus: selectConsensusRevenue({
            years: request.consensus.years,
            capturedAt: request.consensus.capturedAt,
            historyEnd: lastFiscalYearEnd,
            baseAsOf: baseRevenue.asOf,
            asOf,
            currency: costOfCapital.currency,
          }),
        }
      : { version: DERIVED_ASSUMPTIONS_V2_VERSION, ...measured };
  const assumptions = deriveAssumptions({
    derivation,
    baseFiscalYearEnd,
    ...(ttm === null ? {} : { historyEnd: lastFiscalYearEnd }),
    baseRevenue: baseRevenue.value,
    normalization,
    costOfCapital,
  });

  if (assumptions.status === "unavailable") {
    return notAssembled(assumptions.reason);
  }

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
          fiscalYearEnd: lastFiscalYearEnd,
          knownAt,
          sourceId: request.fundamentalsSourceId,
        }) ?? {
          basis: "not_subtracted",
          version: EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION,
          fiscalYearEnd: lastFiscalYearEnd,
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
    qualityFlags: [...(shares.qualityFlags ?? [])],
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
  // Cero sólo con el estado de patrimonio del filing de ese mismo cierre.
  const evidence = request.noncontrollingInterest ?? null;
  const noncontrollingZero =
    evidence?.status === "zero" &&
    balance.equity !== null &&
    evidence.asOf === balance.equity.asOf
      ? evidence
      : null;
  // Cada claim del puente lleva la fecha de su bloque de balance.
  const atDate =
    (asOf: string) =>
    (value: string, provenance: MonetaryFact): MonetaryFact => ({
      ...withoutConcept(provenance),
      value,
      asOf,
    });
  const atBalance = atDate(balanceAsOf);
  const atLeases = atDate(leasesAsOf);
  // La provenance de la deuda es la del primer componente que la receta sumó:
  // con financiera cautiva, el del miembro industrial (ADR 0082).
  const debtFacts =
    normalization.facts.captiveFinance?.industrialDebt ?? balance.debt;
  const firstDebtFact = (
    normalization.debt.status === "resolved"
      ? normalization.debt.included.map((entry) => debtFacts[entry.component])
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
          ? reported(atBalance(normalization.excessCash.total, balance.cash))
          : missing,
      nonOperatingAssets: declaredAbsent(
        `${derivation.version}: no recipe separates non-operating assets; valued at zero and named.`,
      ),
      debt:
        normalization.debt.status === "resolved" && firstDebtFact !== undefined
          ? reported(atBalance(normalization.debt.total, firstDebtFact))
          : normalization.debt.status === "zero_with_evidence"
            ? declaredAbsent(
                `${normalization.debt.evidence}: no borrowing or scheduled debt maturity in the last ${normalization.facts.zeroDebtEvidence?.fiscalYears.length ?? ZERO_DEBT_FISCAL_YEARS} fiscal years, and interest is absent or within the top rating band; valued at zero and named.`,
              )
            : missing,
      leaseDebt:
        leases.status === "capitalized" && leaseFact !== null
          ? reported(atLeases(leases.leaseDebt, leaseFact))
          : leases.status === "not_capitalized" &&
              leases.reason === "lease_liability_missing"
            ? declaredAbsent(
                "No operating lease liability is reported in the base-year balance sheet.",
              )
            : leases.status === "not_capitalized" &&
                leases.reason === "ifrs16_lease_in_debt"
              ? declaredAbsent(
                  `${leases.version}: under IFRS 16 the lease liability is part of the reported debt and its interest is already below EBIT; no operating lease is capitalized.`,
                )
              : missing,
      minorityInterest:
        balance.minorityInterest !== null
          ? reported(balance.minorityInterest)
          : normalization.investedCapital.status === "resolved" &&
              normalization.investedCapital.minorityInterestBasis ===
                "included_in_equity"
            ? noncontrollingZero !== null
              ? declaredAbsent(
                  noncontrollingInterestRationale(noncontrollingZero),
                )
              : missing
            : declaredAbsent(
                "No noncontrolling interest is reported in the base-year balance sheet.",
              ),
      otherClaims: declaredAbsent(
        `${derivation.version}: no recipe reads preferred or other senior claims; valued at zero and named.`,
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
    ...(basePeriod === null ? {} : { basePeriod }),
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
