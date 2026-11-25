import type {
  XbrlContext,
  XbrlShareFact,
  XbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";
import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import {
  type Dec,
  divide,
  engineDecimalSchema,
  parseDecimal,
  ZERO,
} from "./decimal-policy";
import {
  FINANCIAL_XBRL_EVIDENCE_VERSION,
  financialFilingEvidenceSchema,
  type FinancialFilingEvidence,
} from "./financial-filing-evidence";
import type { MonetaryFact } from "./valuation-facts";

/**
 * La base financiera desde el XBRL del 10-K (`financial-xbrl-evidence-1.0.0`,
 * `F6-50`, opción (a) del owner para Berkshire Hathaway).
 *
 * `financial-filing-evidence-1.1.0` lee las tablas HTML de JPM y PRU por sus
 * rótulos. Berkshire no publica `CommonStockholdersEquity` ni la utilidad
 * disponible a comunes, y sus tablas no son las de un banco; su instance sí
 * trae todo lo que el modelo necesita, con evidencia en vez de ausencias:
 *
 * - **Patrimonio común**: `StockholdersEquity` (de la controlante) al cierre y
 *   al cierre previo, sólo si el mismo filing publica las preferentes en cero
 *   (`PreferredStockSharesIssued`, `…SharesOutstanding`, `PreferredStockValue`,
 *   `…ValueOutstanding`). Sin ninguno publicado no hay evidencia
 *   (`preferred_not_evidenced`); uno distinto de cero es otro reclamo
 *   (`preferred_outstanding`).
 * - **Utilidad común**: `NetIncomeLoss` del ejercicio, sólo si algún EPS básico
 *   —sin dimensiones o de una clase— por sus acciones básicas la reproduce
 *   dentro del redondeo impreso: dividendos preferentes o una asignación a
 *   valores participantes la romperían (`earnings_bridge_mismatch`). Berkshire:
 *   46.563 × 1.438.223 acciones equivalentes A = 66.968 M.
 * - **Distribución**: dividendos comunes pagados y recompras del flujo de
 *   fondos. Uno que no se publica es cero sólo si el patrimonio limpio cierra:
 *   `|Δpatrimonio − (resultado integral − distribuciones)|` no pasa el 2 % de
 *   la utilidad (Berkshire 2025: 53 M sobre 66.968 M, 0,08 %). Si no cierra,
 *   una distribución puede faltar (`distribution_unsupported`).
 * - **Diagnósticos fechados**, no aprobaciones: capital y superávit estatutario
 *   (`regulatory_capital_missing` sin él), pasivo por siniestros o previsión de
 *   pérdidas crediticias (`asset_quality_missing` sin ninguno) y el residuo del
 *   patrimonio limpio. El capital estatutario es de las aseguradoras; el
 *   patrimonio valuado es el consolidado del grupo, y el texto lo dice.
 */
export { FINANCIAL_XBRL_EVIDENCE_VERSION };

export const FINANCIAL_XBRL_US_GAAP_CONCEPTS = [
  "StockholdersEquity",
  "PreferredStockSharesIssued",
  "PreferredStockSharesOutstanding",
  "PreferredStockValue",
  "PreferredStockValueOutstanding",
  "NetIncomeLoss",
  "EarningsPerShareBasic",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "ComprehensiveIncomeNetOfTax",
  "PaymentsOfDividendsCommonStock",
  "PaymentsOfDividends",
  "PaymentsForRepurchaseOfCommonStock",
  "StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
  "StatutoryAccountingPracticesStatutoryAmountAvailableForDividendPayments",
  "LiabilityForClaimsAndClaimsAdjustmentExpense",
  "FinancingReceivableAllowanceForCreditLosses",
] as const;

/** Lo que el patrimonio limpio puede no explicar, sobre la utilidad. */
export const CLEAN_SURPLUS_TOLERANCE = "0.02";

const CLASS_AXIS = "StatementClassOfStockAxis";
const MIN_DAYS = 350;
const MAX_DAYS = 380;
const DAY_MS = 86_400_000;
const PREFERRED = [
  "us-gaap:PreferredStockSharesIssued",
  "us-gaap:PreferredStockSharesOutstanding",
  "us-gaap:PreferredStockValue",
  "us-gaap:PreferredStockValueOutstanding",
] as const;

export type FinancialXbrlUnavailableReason =
  | "filing_year_mismatch"
  | "common_equity_missing"
  | "preferred_not_evidenced"
  | "preferred_outstanding"
  | "earnings_bridge_mismatch"
  | "distribution_unsupported"
  | "regulatory_capital_missing"
  | "asset_quality_missing";

export type FinancialXbrlResult =
  | { readonly status: "ready"; readonly evidence: FinancialFilingEvidence }
  | {
      readonly status: "unavailable";
      readonly reason: FinancialXbrlUnavailableReason;
    };

type Found = { readonly value: Dec; readonly fact: XbrlShareFact };

function fullYearEndingOn(context: XbrlContext, endDate: string): boolean {
  if (context.startDate === null || context.endDate !== endDate) return false;
  const days =
    (Date.parse(`${context.endDate}T00:00:00Z`) -
      Date.parse(`${context.startDate}T00:00:00Z`)) /
      DAY_MS +
    1;
  return days >= MIN_DAYS && days <= MAX_DAYS;
}

function halfUnit(decimals: number | null): Dec {
  return decimals === null
    ? ZERO
    : parseDecimal("0.5", "halfUnit").times(
        parseDecimal("10", "base").pow(-decimals),
      );
}

/** Millones con los decimales que hagan falta, para los textos de revisión. */
function millions(value: Dec): string {
  return value.div(1_000_000).toDecimalPlaces(1).toString();
}

export function deriveFinancialXbrlEvidence(input: {
  readonly cik: string;
  readonly read: XbrlShareFacts;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
}): FinancialXbrlResult {
  const { read, report, fiscalYearEnd, priorFiscalYearEnd } = input;
  if (report.reportDate !== fiscalYearEnd) {
    return { status: "unavailable", reason: "filing_year_mismatch" };
  }

  type Where =
    | { readonly kind: "instant"; readonly date: string }
    | { readonly kind: "year" };
  /** Valores distintos de un concepto, por miembro (`null` sin dimensiones). */
  const collect = (concept: string, where: Where, unit: string) => {
    const byMember = new Map<string | null, Found[]>();
    for (const fact of read.facts) {
      if (fact.concept !== concept || fact.unit !== unit) continue;
      const context = read.contexts.get(fact.contextId);
      if (
        context === undefined ||
        context.cik !== input.cik ||
        context.typed ||
        context.members.length > 1 ||
        !engineDecimalSchema.safeParse(fact.value).success ||
        (where.kind === "instant"
          ? context.instant !== where.date
          : !fullYearEndingOn(context, fiscalYearEnd))
      ) {
        continue;
      }
      const member = context.members[0]?.member ?? null;
      const list = byMember.get(member) ?? [];
      if (!list.some((entry) => entry.fact.value === fact.value)) {
        list.push({ value: parseDecimal(fact.value, concept), fact });
      }
      byMember.set(member, list);
    }
    return byMember;
  };
  const undimensioned = (concept: string, where: Where, unit: string) => {
    const list = collect(concept, where, unit).get(null) ?? [];
    return list.length === 1 ? list[0]! : null;
  };
  /** Sin dimensiones o, si no, el valor en que coinciden todos los miembros. */
  const agreed = (concept: string, where: Where, unit: string) => {
    const byMember = collect(concept, where, unit);
    const plain = byMember.get(null);
    if (plain !== undefined) return plain.length === 1 ? plain[0]! : null;
    const values = [...byMember.values()].flat();
    return values.length > 0 &&
      values.every((entry) => entry.value.eq(values[0]!.value))
      ? values[0]!
      : null;
  };
  const close = { kind: "instant", date: fiscalYearEnd } as const;
  const priorClose = { kind: "instant", date: priorFiscalYearEnd } as const;
  const year = { kind: "year" } as const;

  const book = undimensioned("us-gaap:StockholdersEquity", close, "usd");
  const prior = undimensioned("us-gaap:StockholdersEquity", priorClose, "usd");
  if (book === null || prior === null) {
    return { status: "unavailable", reason: "common_equity_missing" };
  }

  const preferred = PREFERRED.flatMap((concept) => {
    const found = undimensioned(
      concept,
      close,
      concept.endsWith("Value") || concept.endsWith("ValueOutstanding")
        ? "usd"
        : "shares",
    );
    return found === null ? [] : [found];
  });
  if (preferred.length === 0) {
    return { status: "unavailable", reason: "preferred_not_evidenced" };
  }
  if (preferred.some((entry) => !entry.value.isZero())) {
    return { status: "unavailable", reason: "preferred_outstanding" };
  }

  const income = undimensioned("us-gaap:NetIncomeLoss", year, "usd");
  if (income === null) {
    return { status: "unavailable", reason: "earnings_bridge_mismatch" };
  }
  const eps = collect("us-gaap:EarningsPerShareBasic", year, "usd_per_share");
  const shares = collect(
    "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
    year,
    "shares",
  );
  const reconciles = [...eps].some(([member, perShare]) => {
    const count = shares.get(member);
    if (
      perShare.length !== 1 ||
      count?.length !== 1 ||
      (member !== null && !isClassMember(read, member))
    ) {
      return false;
    }
    const residual = income.value
      .minus(perShare[0]!.value.times(count[0]!.value))
      .abs();
    const tolerance = halfUnit(perShare[0]!.fact.decimals)
      .times(count[0]!.value)
      .plus(halfUnit(count[0]!.fact.decimals).times(perShare[0]!.value.abs()))
      .plus(halfUnit(income.fact.decimals));
    return residual.lessThanOrEqualTo(tolerance);
  });
  if (!reconciles) {
    return { status: "unavailable", reason: "earnings_bridge_mismatch" };
  }

  const dividends =
    undimensioned("us-gaap:PaymentsOfDividendsCommonStock", year, "usd") ??
    undimensioned("us-gaap:PaymentsOfDividends", year, "usd");
  const repurchases = undimensioned(
    "us-gaap:PaymentsForRepurchaseOfCommonStock",
    year,
    "usd",
  );
  const comprehensive = undimensioned(
    "us-gaap:ComprehensiveIncomeNetOfTax",
    year,
    "usd",
  );
  const dividendValue = dividends?.value ?? ZERO;
  const repurchaseValue = repurchases?.value ?? ZERO;
  const distributions = dividendValue.plus(repurchaseValue);
  const change = book.value.minus(prior.value);
  const residual =
    comprehensive === null
      ? null
      : change.minus(comprehensive.value.minus(distributions));
  const absent = dividends === null || repurchases === null;
  if (
    !income.value.gt(ZERO) ||
    dividendValue.lt(ZERO) ||
    repurchaseValue.lt(ZERO) ||
    distributions.gt(income.value) ||
    (absent &&
      (residual === null ||
        residual
          .abs()
          .greaterThan(
            income.value.times(
              parseDecimal(CLEAN_SURPLUS_TOLERANCE, "cleanSurplusTolerance"),
            ),
          )))
  ) {
    return { status: "unavailable", reason: "distribution_unsupported" };
  }

  const surplus = agreed(
    "us-gaap:StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
    close,
    "usd",
  );
  if (surplus === null) {
    return { status: "unavailable", reason: "regulatory_capital_missing" };
  }
  const priorSurplus = agreed(
    "us-gaap:StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
    priorClose,
    "usd",
  );
  const capacity = agreed(
    "us-gaap:StatutoryAccountingPracticesStatutoryAmountAvailableForDividendPayments",
    close,
    "usd",
  );
  // Diagnóstico, no cálculo: sin total sin dimensiones se listan los miembros.
  const reserves = describeByMember(
    collect(
      "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
      close,
      "usd",
    ),
  );
  const allowance = undimensioned(
    "us-gaap:FinancingReceivableAllowanceForCreditLosses",
    close,
    "usd",
  );
  if (reserves === null && allowance === null) {
    return { status: "unavailable", reason: "asset_quality_missing" };
  }

  const flags = [FINANCIAL_XBRL_EVIDENCE_VERSION];
  const fact = (
    amount: Dec,
    asOf: string,
    extra: readonly string[] = [],
  ): MonetaryFact => ({
    value: amount.toString(),
    asOf,
    currency: "USD",
    unit: "monetary",
    availableAt: report.acceptedAt,
    sourceId: "sec-edgar",
    sourceDocumentId: report.accessionNumber,
    observationId: null,
    qualityFlags: [...flags, ...extra],
  });
  const zeroByCleanSurplus = ["zero_by_clean_surplus"];
  const year4 = fiscalYearEnd.slice(0, 4);
  const accession = report.accessionNumber;

  return {
    status: "ready",
    evidence: financialFilingEvidenceSchema.parse({
      version: FINANCIAL_XBRL_EVIDENCE_VERSION,
      fiscalYearEnd,
      commonBook: fact(book.value, fiscalYearEnd),
      priorBook: fact(prior.value, priorFiscalYearEnd),
      commonIncome: fact(income.value, fiscalYearEnd),
      commonDividends: fact(
        dividendValue,
        fiscalYearEnd,
        dividends === null ? zeroByCleanSurplus : [],
      ),
      netRepurchases: fact(
        repurchaseValue,
        fiscalYearEnd,
        repurchases === null ? zeroByCleanSurplus : [],
      ),
      payout: divide(distributions, income.value, "payout").toString(),
      regulatoryCapital: `Capital y superávit estatutario de las aseguradoras: USD ${millions(surplus.value)} millones al cierre ${year4}${priorSurplus === null ? "" : ` (USD ${millions(priorSurplus.value)} millones el previo)`}${capacity === null ? "" : `; disponible para dividendos sin aprobación regulatoria: USD ${millions(capacity.value)} millones`}. El XBRL no publica un requisito, así que no se contrasta. Es capital de las subsidiarias aseguradoras; el patrimonio valuado es el consolidado del grupo, con todos sus negocios (${accession}).`,
      assetQuality: capitalized(
        `${reserves === null ? "" : `pasivo por siniestros y gastos de liquidación: ${reserves}; `}${allowance === null ? "" : `previsión por pérdidas crediticias: USD ${millions(allowance.value)} millones; `}no prueba suficiencia de reservas (${accession}).`,
      ),
      cleanSurplus: `Cambio del patrimonio común: USD ${millions(change)} millones; ${comprehensive === null ? "sin resultado integral publicado" : `resultado integral de la controlante menos dividendos y recompras: USD ${millions(comprehensive.value.minus(distributions))} millones; residuo de transacciones de capital y otros movimientos: USD ${millions(residual!)} millones`}${absent ? "; una distribución no publicada se toma como cero porque el patrimonio limpio cierra" : ""} (${accession}).`,
      sourceDocumentId: accession,
      availableAt: report.acceptedAt,
    }),
  };
}

/** `USD n millones` o, por miembro, hasta cuatro valores distintos. */
function describeByMember(
  byMember: ReadonlyMap<string | null, readonly Found[]>,
): string | null {
  const plain = byMember.get(null);
  if (plain !== undefined) {
    return plain.length === 1
      ? `USD ${millions(plain[0]!.value)} millones`
      : null;
  }
  const entries = [...byMember]
    .filter(([, values]) => values.length === 1)
    .map(([member, values]) => [member!, values[0]!.value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return null;
  const distinct = [
    ...new Map(
      entries.map(([member, value]) => [
        value.toString(),
        [member, value] as const,
      ]),
    ).values(),
  ].slice(0, 4);
  return distinct
    .map(([member, value]) => `USD ${millions(value)} millones (${member})`)
    .join(", ");
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isClassMember(read: XbrlShareFacts, member: string): boolean {
  for (const context of read.contexts.values()) {
    const only = context.members[0];
    if (
      context.members.length === 1 &&
      only!.member === member &&
      only!.axis === CLASS_AXIS
    ) {
      return true;
    }
  }
  return false;
}
