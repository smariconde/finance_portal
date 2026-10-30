import type { ValuationSnapshotRequest } from "./assemble-valuation-snapshot";
import { seriesFact } from "./assess-company";
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
import {
  DECIMAL_POLICY,
  formatDecimal,
  parseDecimal,
} from "../domain/decimal-policy";
import { consecutiveRevenueHistory } from "../domain/derived-assumptions";
import {
  deriveReitAssumptions,
  isEquityPropertyShare,
  reitPropertyShare,
} from "../domain/derived-reit";
import { reconcileAffo } from "../domain/reit";
import {
  DERIVED_REIT_ENGINE_VERSION,
  DERIVED_REIT_METHODOLOGY_VERSION,
  DERIVED_REIT_VERSION,
  reitInputSchema,
  type DerivedReit,
  type ReitInput,
} from "../domain/reit-input";
import type { LineItemValue } from "../domain/annual-fundamentals";
import type { ValuationSnapshotGap } from "../domain/valuation-job";

export const REIT_SNAPSHOT_ASSEMBLY_VERSION = "reit-snapshot-1.0.0";

export type ReitSnapshotResult =
  | { readonly status: "assembled"; readonly input: ReitInput }
  | { readonly status: "not_assembled"; readonly gap: ValuationSnapshotGap };

const notAssembled = (gap: ValuationSnapshotGap): ReitSnapshotResult => ({
  status: "not_assembled",
  gap,
});

/**
 * El snapshot `affo-nav-1.1.0` de un REIT de propiedades desde lo guardado
 * (`F6-22`, ADR 0064): AFFO con los componentes que el XBRL del ejercicio base
 * etiqueta, base de propiedades medida, costo de equity de la industria y
 * supuestos de `derived-reit-1.0.0`. Sin IA, sin red y sin declaraciones; el
 * NAV queda declarado ausente.
 */
export function assembleReitSnapshot(
  request: ValuationSnapshotRequest,
): ReitSnapshotResult {
  const { assessment } = request;
  if (
    assessment.selection.status !== "selected" ||
    assessment.selection.recommendedMethod !== "affo_nav"
  )
    return notAssembled("method_not_derived");
  if (request.subject.securityId === null)
    return notAssembled("security_missing");
  const series = assessment.fundamentals.series;
  const base = series?.fiscalYears[0];
  if (series === null || base === undefined)
    return notAssembled("reit_affo_anchor_unavailable");
  const items = base.items;
  if (
    items.common_net_income === undefined ||
    items.real_estate_depreciation === undefined
  )
    return notAssembled("reit_affo_anchor_unavailable");
  if (
    items.real_estate_property_net === undefined ||
    items.assets === undefined
  )
    return notAssembled("reit_property_basis_unavailable");
  const share = reitPropertyShare(
    items.real_estate_property_net.value,
    items.assets.value,
  );
  if (share === null || !isEquityPropertyShare(share))
    return notAssembled("reit_property_basis_unavailable");
  const risk = assessment.financialRisk;
  if (risk?.status !== "ready")
    return notAssembled("cost_of_capital_unavailable");

  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const asOf = request.prices.closes
    .map((close) => close.marketDate)
    .filter((date) => date <= knownAt.slice(0, 10))
    .sort()
    .at(-1);
  if (asOf === undefined) return notAssembled("market_unavailable");
  const ageDays = (date: string) =>
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    86_400_000;
  // La receta exige un ejercicio de no más de 380 días antes del `asOf`.
  if (ageDays(base.fiscalYearEnd) < 0 || ageDays(base.fiscalYearEnd) > 380)
    return notAssembled("financial_base_stale");
  const shares = sharesOutstandingAt(request.shareCounts, { asOf, knownAt });
  if (shares === null || ageDays(shares.asOf) > 180)
    return notAssembled("shares_outstanding_unavailable");

  const commonEquity = commonEquityAt(items);
  if (commonEquity === null) return notAssembled("financial_base_unavailable");
  const history = consecutiveRevenueHistory(
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
    base.fiscalYearEnd,
  );
  if (history.length < 3)
    return notAssembled("growth_revenue_history_unavailable");

  const fact = (item: LineItemValue) =>
    seriesFact(item, request.fundamentalsSourceId);
  const optional = (item: LineItemValue | undefined) =>
    item === undefined ? null : fact(item);

  const accepted =
    request.employeeEquity?.proposal.outcome === "accepted" &&
    request.employeeEquity.proposal.fiscalYearEnd === base.fiscalYearEnd &&
    request.employeeEquity.proposal.transcription !== null &&
    request.employeeEquity.proposal.respondedModel !== null
      ? request.employeeEquity
      : null;
  const xbrl = employeeOptionsXbrlAt(request.employeeOptionFacts ?? [], {
    fiscalYearEnd: base.fiscalYearEnd,
    knownAt,
    sourceId: request.fundamentalsSourceId,
  });
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
      : (xbrl ?? {
          basis: "not_subtracted",
          version: EMPLOYEE_OPTIONS_NOT_SUBTRACTED_VERSION,
          fiscalYearEnd: base.fiscalYearEnd,
          reason: "no_transcription_or_xbrl",
        });
  const outstanding =
    decision.basis === "ai_proposal"
      ? decision.transcription.optionsStatus === "outstanding"
      : decision.basis === "xbrl_same_10k" && decision.weightedStrike !== null;
  let market: EmployeeOptionMarket | null = null;
  if (outstanding) {
    const result = employeeOptionMarketAt({
      subjectId: request.subject.securityId,
      asOf,
      sourceId: request.prices.sourceId,
      closes: request.prices.closes,
      events: request.prices.events,
    });
    if ("reason" in result) return notAssembled("market_unavailable");
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

  const affo = {
    version: "affo-reconciliation-1.0.0" as const,
    periodStart: periodStart(items.common_net_income),
    periodEnd: base.fiscalYearEnd,
    rationale: `${DERIVED_REIT_VERSION}: every component is the XBRL fact of the base fiscal year named in derivedReit.affoBasis; untagged components are not applied and the run names them. The joint-venture FFO adjustment has no XBRL concept.`,
    commonNetIncome: fact(items.common_net_income),
    realEstateDepreciation: fact(items.real_estate_depreciation),
    propertySaleGains: optional(items.property_sale_gains),
    realEstateImpairments: optional(items.real_estate_impairment),
    jointVentureAdjustment: null,
    recurringCapex: optional(items.recurring_capex),
    straightLineRent: optional(items.straight_line_rent),
  };
  const derivedReit: DerivedReit = {
    version: DERIVED_REIT_VERSION,
    affoBasis: {
      commonNetIncome: items.common_net_income.concept,
      realEstateDepreciation: items.real_estate_depreciation.concept,
      propertySaleGains: items.property_sale_gains?.concept ?? null,
      realEstateImpairments: items.real_estate_impairment?.concept ?? null,
      jointVentureAdjustment: null,
      recurringCapex: items.recurring_capex?.concept ?? null,
      straightLineRent: items.straight_line_rent?.concept ?? null,
    },
    propertyShare: {
      realEstatePropertyNet: fact(items.real_estate_property_net),
      assets: fact(items.assets),
      share: formatDecimal(share, "propertyShare"),
    },
    revenueHistory: history.map((year) => ({ ...year })),
    commonEquity: commonEquity.fact(fact),
    commonEquityBasis: commonEquity.basis,
    equityBeta: risk.equityBeta,
  };

  const draft = {
    method: "affo_nav" as const,
    engineVersion: DERIVED_REIT_ENGINE_VERSION,
    methodologyVersion: DERIVED_REIT_METHODOLOGY_VERSION,
    decimalPolicy: DECIMAL_POLICY,
    subject: {
      ...request.subject,
      securityId: request.subject.securityId,
      depositaryProgramId: null,
    },
    asOf,
    currency: items.common_net_income.currency ?? "USD",
    knowledge: request.query,
    assetProfile: "reit" as const,
    profileEvidence: assessment.evidence,
    propertyBasis: "equity_property" as const,
    scopeRationale: `${DERIVED_REIT_VERSION}: real estate held is ${formatDecimal(share, "share")} of total assets at the base close, at or above the equity-property floor.`,
    affo,
    derivedReit,
    nav: null,
    risk: risk.risk,
    employeeEquity: {
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
    },
    employeeEquityAvailableAt:
      accepted?.proposal.proposedAt ??
      xbrl?.optionsOutstanding.availableAt ??
      shares.availableAt,
    scenarios: null,
    sensitivity: null,
  };
  // Con AFFO o patrimonio no positivos la regla no deriva supuestos: la
  // brecha se nombra en vez de inventar un crecimiento.
  const assumptions = deriveReitAssumptions(
    draft,
    derivedReit,
    reconcileAffo(draft).affo,
  );
  if (assumptions === null) return notAssembled("financial_base_unavailable");
  return {
    status: "assembled",
    input: reitInputSchema.parse({ ...draft, assumptions }),
  };
}

/** El inicio del ejercicio del hecho anual, o un año antes de su cierre. */
function periodStart(item: LineItemValue): string {
  const end = new Date(`${item.asOf}T00:00:00Z`);
  end.setUTCFullYear(end.getUTCFullYear() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 10);
}

/**
 * El patrimonio común al cierre base: el etiquetado como común; si no, el
 * total menos el preferente; si no hay preferente etiquetado, el total, y la
 * base lo dice.
 */
function commonEquityAt(items: Partial<Record<string, LineItemValue>>): {
  readonly basis: DerivedReit["commonEquityBasis"];
  readonly fact: (
    toFact: (item: LineItemValue) => ReturnType<typeof seriesFact>,
  ) => ReturnType<typeof seriesFact>;
} | null {
  const common = items.common_equity;
  if (common !== undefined)
    return { basis: "common_equity", fact: (f) => f(common) };
  const equity = items.equity;
  if (equity === undefined) return null;
  const preferred = items.preferred_equity;
  if (preferred === undefined)
    return {
      basis: "equity_without_preferred_tagged",
      fact: (f) => f(equity),
    };
  return {
    basis: "equity_less_preferred",
    fact: (f) => ({
      ...f(equity),
      value: parseDecimal(equity.value, "equity")
        .minus(parseDecimal(preferred.value, "preferredEquity"))
        .toString(),
      observationId: null,
      qualityFlags: ["equity_less_preferred"],
    }),
  };
}
