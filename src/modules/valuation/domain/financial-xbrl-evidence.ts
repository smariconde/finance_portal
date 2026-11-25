import type {
  XbrlContext,
  XbrlShareFact,
  XbrlShareFacts,
} from "@/modules/fundamentals/domain/sec-xbrl-instance";
import type { SecAnnualReport } from "@/modules/fundamentals/domain/sec-annual-report";

import type { ExcessReturnProfile } from "./asset-profile";
import {
  type Dec,
  engineDecimalSchema,
  parseDecimal,
  ZERO,
} from "./decimal-policy";
import {
  FINANCIAL_XBRL_EVIDENCE_VERSION,
  financialFilingEvidenceSchema,
  type FinancialFilingEvidence,
} from "./financial-filing-evidence";
import {
  computeThreeYearPayout,
  PAYOUT_YEARS,
  type PayoutYear,
} from "./financial-payout";
import type { MonetaryFact } from "./valuation-facts";

/**
 * La base financiera desde el XBRL del 10-K.
 *
 * La `1.0.0` (`F6-50`, opción (a) del owner para Berkshire Hathaway) leía el
 * patrimonio común sólo con preferentes publicadas en cero y la utilidad como
 * `NetIncomeLoss`. La `1.1.0` (`F6-53`, corredores y bancos de inversión:
 * HOOD, SCHW, GS, MS, RJF, IBKR) la generaliza, con evidencia en vez de
 * ausencias:
 *
 * - **Patrimonio de la controlante** al cierre y al previo:
 *   `StockholdersEquity`; si no se publica, el total con no controlantes menos
 *   `MinorityInterest` del mismo cierre (HOOD).
 * - **Preferentes** a los dos cierres: `PreferredStockValue`,
 *   `…ValueOutstanding` o `…CarryingValue` (GS, SCHW, RJF), o el mismo nombre
 *   en la extensión del filer (`ms:PreferredStockCarryingValue`, 9.750 M de
 *   MS). Cero con evidencia: acciones emitidas o en circulación publicadas en
 *   cero (BRK, HOOD), o un estado de patrimonio cuyos componentes suman el de la
 *   controlante sin columna de preferentes (IBKR). Sin nada de eso,
 *   `preferred_not_evidenced`. El patrimonio común es la controlante menos las
 *   preferentes de cada cierre.
 * - **Utilidad común**: `NetIncomeLossAvailableToCommonStockholdersBasic`, o
 *   `NetIncomeLoss` sólo sin preferentes, si el EPS básico por sus acciones la
 *   reproduce dentro del redondeo impreso; hasta 1 % de desvío se acepta y se
 *   nombra (`participating_allocation_unpublished`): es la asignación a
 *   valores participantes que GS no etiqueta (16.300 M contra 16.244,6 M).
 * - **Distribuciones de tres ejercicios** del mismo 10-K, cada una por una
 *   escalera de conceptos con nombre. Dividendos que no se publican son cero si
 *   los resultados acumulados ruedan exactamente con la utilidad del año
 *   (`zero_by_retained_earnings_roll`, HOOD) o si el patrimonio limpio cierra a
 *   2 % (`zero_by_clean_surplus`, BRK); recompras, sólo por lo segundo. El
 *   payout es el del trienio con tope en uno (`financial-payout-three-years`).
 * - **Diagnósticos fechados**, no aprobaciones: capital y superávit estatutario
 *   (aseguradoras), CET1 con su mínimo (bancos y holdings bancarias) y
 *   previsiones por pérdidas crediticias. Para un banco o una aseguradora su
 *   ausencia sigue negando la base (`regulatory_capital_missing`,
 *   `asset_quality_missing`); para un broker-dealer se nombra: HOOD no etiqueta
 *   el net capital de sus subsidiarias.
 */
export { FINANCIAL_XBRL_EVIDENCE_VERSION };

export const FINANCIAL_XBRL_US_GAAP_CONCEPTS = [
  "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "MinorityInterest",
  "PreferredStockSharesIssued",
  "PreferredStockSharesOutstanding",
  "PreferredStockValue",
  "PreferredStockValueOutstanding",
  "PreferredStockCarryingValue",
  "NetIncomeLoss",
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "EarningsPerShareBasic",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "ComprehensiveIncomeNetOfTax",
  "PaymentsOfDividendsCommonStock",
  "DividendsCommonStockCash",
  "DividendsCommonStock",
  "PaymentsOfOrdinaryDividends",
  "PaymentsOfDividends",
  "PaymentsForRepurchaseOfCommonStock",
  "TreasuryStockValueAcquiredCostMethod",
  "StockRepurchasedDuringPeriodValue",
  "StockRepurchasedAndRetiredDuringPeriodValue",
  "StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
  "StatutoryAccountingPracticesStatutoryAmountAvailableForDividendPayments",
  "CommonEquityTierOneCapitalRatio",
  "BankingRegulationCommonEquityTierOneRiskBasedCapitalRatioCapitalAdequacyMinimum",
  "CommonEquityTierOneCapitalRequiredForCapitalAdequacyToRiskWeightedAssets",
  "CommonEquityTierOneCapital",
  "CommonEquityTierOneCapitalRequiredForCapitalAdequacy",
  "LiabilityForClaimsAndClaimsAdjustmentExpense",
  "FinancingReceivableAllowanceForCreditLosses",
  "FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest",
  "AllowanceForDoubtfulAccountsReceivable",
] as const;

/** Preferentes con el nombre de `us-gaap` en la extensión del filer (MS). */
export const FINANCIAL_XBRL_EXTENSION_CONCEPTS = [
  "PreferredStockCarryingValue",
  "PreferredStockValue",
] as const;

/** Lo que el patrimonio limpio puede no explicar, sobre la utilidad. */
export const CLEAN_SURPLUS_TOLERANCE = "0.02";
/** El desvío del puente del EPS que se acepta nombrándolo. */
export const PARTICIPATING_ALLOCATION_TOLERANCE = "0.01";

const CLASS_AXIS = "StatementClassOfStockAxis";
const COMPONENTS_AXIS = "StatementEquityComponentsAxis";
const NCI_MEMBER = "NoncontrollingInterestMember";
const PARENT_MEMBER = "ParentMember";
const MIN_DAYS = 350;
const MAX_DAYS = 380;
const DAY_MS = 86_400_000;

const PREFERRED_VALUES = [
  "us-gaap:PreferredStockValue",
  "us-gaap:PreferredStockValueOutstanding",
  "us-gaap:PreferredStockCarryingValue",
  "extension:PreferredStockCarryingValue",
  "extension:PreferredStockValue",
] as const;
const PREFERRED_SHARES = [
  "us-gaap:PreferredStockSharesIssued",
  "us-gaap:PreferredStockSharesOutstanding",
] as const;
const DIVIDEND_LADDER = [
  "us-gaap:PaymentsOfDividendsCommonStock",
  "us-gaap:DividendsCommonStockCash",
  "us-gaap:DividendsCommonStock",
  "us-gaap:PaymentsOfOrdinaryDividends",
] as const;
const REPURCHASE_LADDER = [
  "us-gaap:PaymentsForRepurchaseOfCommonStock",
  "us-gaap:TreasuryStockValueAcquiredCostMethod",
  "us-gaap:StockRepurchasedDuringPeriodValue",
  "us-gaap:StockRepurchasedAndRetiredDuringPeriodValue",
] as const;

export type FinancialXbrlUnavailableReason =
  | "filing_year_mismatch"
  | "common_equity_missing"
  | "preferred_not_evidenced"
  | "preferred_outstanding"
  | "earnings_bridge_mismatch"
  | "payout_history_missing"
  | "payout_year_unpublished"
  | "distribution_unsupported"
  | "regulatory_capital_missing"
  | "asset_quality_missing";

export type FinancialXbrlResult =
  | { readonly status: "ready"; readonly evidence: FinancialFilingEvidence }
  | {
      readonly status: "unavailable";
      readonly reason: Exclude<
        FinancialXbrlUnavailableReason,
        "payout_year_unpublished"
      >;
    }
  | {
      /** Un ejercicio del trienio sin el concepto que el 10-K usa los otros. */
      readonly status: "unavailable";
      readonly reason: "payout_year_unpublished";
      readonly concept: string;
    };

/**
 * Un punto de `companyconcept` (`sec-companyconcept-1.0.0`): el mismo concepto
 * publicado por un 10-K anterior para el ejercicio que el último ya no trae.
 */
export type EarlierAnnualFact = {
  readonly concept: string;
  readonly unit: string;
  readonly start: string | null;
  readonly end: string;
  readonly value: string;
  readonly accessionNumber: string;
  readonly form: string;
  readonly filed: string;
};

type Found = { readonly value: Dec; readonly fact: XbrlShareFact };
type Where =
  | { readonly kind: "instant"; readonly date: string }
  | { readonly kind: "year"; readonly end: string };

function daysBetween(start: string, end: string): number {
  return (
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS
  );
}

function isFullYear(context: XbrlContext): boolean {
  if (context.startDate === null || context.endDate === null) return false;
  const days = daysBetween(context.startDate, context.endDate) + 1;
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

function percent(value: Dec): string {
  return value.times(100).toDecimalPlaces(2).toString();
}

function localName(concept: string): string {
  return concept.replace(/^[^:]+:/u, "");
}

export function deriveFinancialXbrlEvidence(input: {
  readonly cik: string;
  readonly read: XbrlShareFacts;
  readonly report: SecAnnualReport;
  readonly fiscalYearEnd: string;
  readonly priorFiscalYearEnd: string;
  /** Sin perfil se lee como banco o aseguradora: los diagnósticos se exigen. */
  readonly assetProfile?: ExcessReturnProfile;
  /**
   * Los puntos de un concepto en 10-K anteriores (`companyconcept`), sólo para
   * una distribución de un ejercicio que el último ya no etiqueta: MS publica
   * sus recompras de dos años.
   */
  readonly earlierFacts?: readonly EarlierAnnualFact[];
}): FinancialXbrlResult {
  const { read, report, fiscalYearEnd, priorFiscalYearEnd } = input;
  if (report.reportDate !== fiscalYearEnd) {
    return { status: "unavailable", reason: "filing_year_mismatch" };
  }
  const brokerDealer = input.assetProfile === "broker_dealer";

  /**
   * Valores distintos de un concepto, por miembro (`null` sin dimensiones). Los
   * diagnósticos admiten dos ejes: GS publica el CET1 por entidad y por método.
   */
  const collectIn = (
    source: XbrlShareFacts,
    concept: string,
    where: Where,
    unit: string,
    maxMembers = 1,
  ) => {
    const byMember = new Map<string | null, Found[]>();
    for (const fact of source.facts) {
      if (fact.concept !== concept || fact.unit !== unit) continue;
      const context = source.contexts.get(fact.contextId);
      if (
        context === undefined ||
        context.cik !== input.cik ||
        context.typed ||
        context.members.length > maxMembers ||
        !engineDecimalSchema.safeParse(fact.value).success ||
        (where.kind === "instant"
          ? context.instant !== where.date
          : context.endDate !== where.end || !isFullYear(context))
      ) {
        continue;
      }
      const member =
        context.members.length === 0
          ? null
          : context.members
              .map((item) => `${item.axis}=${item.member}`)
              .join("&");
      const list = byMember.get(member) ?? [];
      if (!list.some((entry) => entry.fact.value === fact.value)) {
        list.push({ value: parseDecimal(fact.value, concept), fact });
      }
      byMember.set(member, list);
    }
    return byMember;
  };
  const collect = (
    concept: string,
    where: Where,
    unit: string,
    maxMembers = 1,
  ) => collectIn(read, concept, where, unit, maxMembers);
  const undimensioned = (concept: string, where: Where, unit: string) => {
    const list = collect(concept, where, unit).get(null) ?? [];
    return list.length === 1 ? list[0]! : null;
  };
  /** Sin dimensiones o, si no, el valor en que coinciden todos los miembros. */
  const agreed = (
    concept: string,
    where: Where,
    unit: string,
    source: XbrlShareFacts = read,
  ) => {
    const byMember = collectIn(source, concept, where, unit);
    const plain = byMember.get(null);
    if (plain !== undefined) return plain.length === 1 ? plain[0]! : null;
    const values = [...byMember.values()].flat();
    return values.length > 0 &&
      values.every((entry) => entry.value.eq(values[0]!.value))
      ? values[0]!
      : null;
  };
  const instant = (date: string): Where => ({ kind: "instant", date });
  const yearEnding = (end: string): Where => ({ kind: "year", end });

  /** Los componentes del estado de patrimonio a un cierre, por miembro. */
  const componentsAt = (date: string) => {
    const components = new Map<string, Dec>();
    for (const concept of [
      "us-gaap:StockholdersEquity",
      "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]) {
      for (const [key, values] of collect(concept, instant(date), "usd")) {
        if (key === null || values.length !== 1) continue;
        const [axis, member] = key.split("=") as [string, string];
        if (axis !== COMPONENTS_AXIS) continue;
        const known = components.get(member);
        if (known !== undefined && !known.eq(values[0]!.value)) return null;
        components.set(member, values[0]!.value);
      }
    }
    return components;
  };

  type Parent = { readonly value: Dec; readonly totalLessNci: boolean };
  const parentEquityAt = (date: string): Parent | null => {
    const parent = undimensioned(
      "us-gaap:StockholdersEquity",
      instant(date),
      "usd",
    );
    if (parent !== null) return { value: parent.value, totalLessNci: false };
    const total = undimensioned(
      "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      instant(date),
      "usd",
    );
    const nci = undimensioned("us-gaap:MinorityInterest", instant(date), "usd");
    return total === null || nci === null
      ? null
      : { value: total.value.minus(nci.value), totalLessNci: true };
  };

  type Preferred = {
    readonly value: Dec;
    readonly basis:
      "published" | "filer_extension" | "shares_zero" | "components";
  };
  const preferredAt = (date: string, parent: Dec): Preferred | null => {
    for (const concept of PREFERRED_VALUES) {
      const found = undimensioned(concept, instant(date), "usd");
      if (found !== null) {
        return {
          value: found.value,
          basis: concept.startsWith("extension:")
            ? "filer_extension"
            : "published",
        };
      }
    }
    for (const concept of PREFERRED_SHARES) {
      const found = undimensioned(concept, instant(date), "shares");
      if (found !== null && found.value.isZero()) {
        return { value: ZERO, basis: "shares_zero" };
      }
    }
    // Los componentes de la controlante suman su patrimonio sin preferentes.
    const components = componentsAt(date);
    if (components === null || components.size === 0) return null;
    if ([...components.keys()].some((member) => /Preferred/u.test(member))) {
      return null;
    }
    const sum = [...components]
      .filter(([member]) => member !== NCI_MEMBER && member !== PARENT_MEMBER)
      .reduce((total, [, value]) => total.plus(value), ZERO);
    return sum.eq(parent) ? { value: ZERO, basis: "components" } : null;
  };

  const parent = parentEquityAt(fiscalYearEnd);
  const priorParent = parentEquityAt(priorFiscalYearEnd);
  if (parent === null || priorParent === null) {
    return { status: "unavailable", reason: "common_equity_missing" };
  }
  const preferred = preferredAt(fiscalYearEnd, parent.value);
  const priorPreferred = preferredAt(priorFiscalYearEnd, priorParent.value);
  if (preferred === null || priorPreferred === null) {
    return { status: "unavailable", reason: "preferred_not_evidenced" };
  }
  if (preferred.value.lt(ZERO) || priorPreferred.value.lt(ZERO)) {
    return { status: "unavailable", reason: "preferred_not_evidenced" };
  }
  const hasPreferred =
    !preferred.value.isZero() || !priorPreferred.value.isZero();
  const book = parent.value.minus(preferred.value);
  const prior = priorParent.value.minus(priorPreferred.value);

  // La utilidad común: la disponible a comunes o, sin preferentes, la neta.
  const incomeConcepts = hasPreferred
    ? ["us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic"]
    : [
        "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
        "us-gaap:NetIncomeLoss",
      ];
  const bridge = (income: Found, end: string) => {
    const eps = collect(
      "us-gaap:EarningsPerShareBasic",
      yearEnding(end),
      "usd_per_share",
    );
    const shares = collect(
      "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
      yearEnding(end),
      "shares",
    );
    let best: { residual: Dec; tolerance: Dec } | null = null;
    for (const [member, perShare] of eps) {
      const count = shares.get(member);
      if (
        perShare.length !== 1 ||
        count?.length !== 1 ||
        (member !== null && !member.startsWith(`${CLASS_AXIS}=`))
      ) {
        continue;
      }
      const residual = income.value
        .minus(perShare[0]!.value.times(count[0]!.value))
        .abs();
      const tolerance = halfUnit(perShare[0]!.fact.decimals)
        .times(count[0]!.value)
        .plus(halfUnit(count[0]!.fact.decimals).times(perShare[0]!.value.abs()))
        .plus(halfUnit(income.fact.decimals));
      if (best === null || residual.lt(best.residual)) {
        best = { residual, tolerance };
      }
    }
    return best;
  };
  let incomeConcept: string | null = null;
  let income: Found | null = null;
  let participatingGap: Dec | null = null;
  for (const concept of incomeConcepts) {
    const found = undimensioned(concept, yearEnding(fiscalYearEnd), "usd");
    if (found === null) continue;
    const check = bridge(found, fiscalYearEnd);
    if (check === null) continue;
    if (check.residual.lessThanOrEqualTo(check.tolerance)) {
      incomeConcept = concept;
      income = found;
      break;
    }
    if (
      concept === "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic" &&
      found.value.gt(ZERO) &&
      check.residual.lessThanOrEqualTo(
        found.value.times(
          parseDecimal(
            PARTICIPATING_ALLOCATION_TOLERANCE,
            "participatingTolerance",
          ),
        ),
      )
    ) {
      incomeConcept = concept;
      income = found;
      participatingGap = check.residual;
      break;
    }
  }
  if (income === null || incomeConcept === null) {
    return { status: "unavailable", reason: "earnings_bridge_mismatch" };
  }
  if (!income.value.gt(ZERO)) {
    return { status: "unavailable", reason: "distribution_unsupported" };
  }

  // Los tres ejercicios del 10-K, del base hacia atrás, por la misma utilidad.
  const ends = [fiscalYearEnd];
  for (let index = 1; index < PAYOUT_YEARS; index += 1) {
    const later = ends[index - 1]!;
    const candidates = new Set<string>();
    for (const fact of read.facts) {
      if (fact.concept !== incomeConcept || fact.unit !== "usd") continue;
      const context = read.contexts.get(fact.contextId);
      if (
        context === undefined ||
        context.cik !== input.cik ||
        context.members.length > 0 ||
        context.endDate === null ||
        !isFullYear(context)
      ) {
        continue;
      }
      const gap = daysBetween(context.endDate, later);
      if (gap >= MIN_DAYS && gap <= MAX_DAYS) candidates.add(context.endDate);
    }
    if (candidates.size !== 1) {
      return { status: "unavailable", reason: "payout_history_missing" };
    }
    ends.push([...candidates][0]!);
  }
  if (ends[1] !== priorFiscalYearEnd) {
    return { status: "unavailable", reason: "payout_history_missing" };
  }

  type Rung = {
    readonly concept: string;
    readonly value: Dec;
    readonly accession: string | null;
  };
  const ladder = (concepts: readonly string[], end: string): Rung | null => {
    for (const concept of concepts) {
      const found = agreed(concept, yearEnding(end), "usd");
      if (found !== null) {
        return { concept, value: found.value, accession: null };
      }
    }
    return null;
  };
  /**
   * El mismo concepto en un 10-K presentado antes del último, para el mismo
   * ejercicio completo; con dos valores, el del más reciente.
   */
  const earlier = (concept: string, end: string): Rung | null => {
    const filedBefore = report.acceptedAt.slice(0, 10);
    const matches = (input.earlierFacts ?? []).filter(
      (fact) =>
        `us-gaap:${fact.concept}` === concept &&
        fact.unit === "USD" &&
        fact.form === "10-K" &&
        fact.end === end &&
        fact.start !== null &&
        daysBetween(fact.start, fact.end) + 1 >= MIN_DAYS &&
        daysBetween(fact.start, fact.end) + 1 <= MAX_DAYS &&
        fact.filed < filedBefore &&
        fact.accessionNumber !== report.accessionNumber &&
        engineDecimalSchema.safeParse(fact.value).success,
    );
    const latest = [...matches].sort((left, right) =>
      right.filed.localeCompare(left.filed),
    )[0];
    return latest === undefined
      ? null
      : {
          concept,
          value: parseDecimal(latest.value, concept),
          accession: latest.accessionNumber,
        };
  };
  /** El cierre anterior a un ejercicio: el día previo a su inicio. */
  const openingOf = (end: string): string | null => {
    for (const fact of read.facts) {
      if (fact.concept !== incomeConcept) continue;
      const context = read.contexts.get(fact.contextId);
      if (
        context?.endDate === end &&
        context.startDate !== null &&
        context.members.length === 0 &&
        isFullYear(context)
      ) {
        const start = new Date(`${context.startDate}T00:00:00Z`);
        start.setUTCDate(start.getUTCDate() - 1);
        return start.toISOString().slice(0, 10);
      }
    }
    return null;
  };
  const cleanSurplusResidual = (end: string, distributions: Dec) => {
    const opening = openingOf(end);
    const closing = parentEquityAt(end);
    const before = opening === null ? null : parentEquityAt(opening);
    const comprehensive = undimensioned(
      "us-gaap:ComprehensiveIncomeNetOfTax",
      yearEnding(end),
      "usd",
    );
    if (closing === null || before === null || comprehensive === null) {
      return null;
    }
    return closing.value
      .minus(before.value)
      .minus(comprehensive.value.minus(distributions));
  };
  const retainedEarningsRolls = (end: string, yearIncome: Dec) => {
    const opening = openingOf(end);
    if (opening === null) return false;
    const close = componentsAt(end)?.get("RetainedEarningsMember");
    const open = componentsAt(opening)?.get("RetainedEarningsMember");
    const net = undimensioned("us-gaap:NetIncomeLoss", yearEnding(end), "usd");
    return (
      close !== undefined &&
      open !== undefined &&
      net !== null &&
      !hasPreferred &&
      net.value.eq(yearIncome) &&
      close.minus(open).eq(net.value)
    );
  };

  type YearReading = PayoutYear & {
    readonly dividendsBasis: string;
    readonly repurchasesBasis: string;
  };
  const dividendLadder = hasPreferred
    ? DIVIDEND_LADDER
    : [...DIVIDEND_LADDER, "us-gaap:PaymentsOfDividends"];
  const published = ends.map((end) => ({
    end,
    dividends: ladder(dividendLadder, end),
    repurchases: ladder(REPURCHASE_LADDER, end),
  }));
  /** El concepto que el 10-K usa para una partida en algún ejercicio. */
  const usedConcept = (item: "dividends" | "repurchases") =>
    published.find((year) => year[item] !== null)?.[item]?.concept ?? null;
  const basisOf = (rung: Rung) =>
    rung.accession === null
      ? localName(rung.concept)
      : `${localName(rung.concept)}, 10-K ${rung.accession}`;

  const years: YearReading[] = [];
  for (const year of published) {
    const { end } = year;
    const yearIncome = undimensioned(incomeConcept, yearEnding(end), "usd");
    if (yearIncome === null) {
      return { status: "unavailable", reason: "payout_history_missing" };
    }
    // Un concepto que el 10-K usa otros años es evidencia de que la partida
    // existe: el ejercicio que falta se busca en un 10-K anterior, nunca se
    // presume cero.
    let dividends = year.dividends;
    let repurchases = year.repurchases;
    for (const item of ["dividends", "repurchases"] as const) {
      const current = item === "dividends" ? dividends : repurchases;
      const concept = usedConcept(item);
      if (current !== null || concept === null) continue;
      if (input.earlierFacts === undefined) {
        return {
          status: "unavailable",
          reason: "payout_year_unpublished",
          concept,
        };
      }
      const found = earlier(concept, end);
      if (found === null) {
        return { status: "unavailable", reason: "distribution_unsupported" };
      }
      if (item === "dividends") dividends = found;
      else repurchases = found;
    }
    const dividendValue = dividends?.value ?? ZERO;
    const repurchaseValue = repurchases?.value ?? ZERO;
    if (dividendValue.lt(ZERO) || repurchaseValue.lt(ZERO)) {
      return { status: "unavailable", reason: "distribution_unsupported" };
    }
    let dividendsBasis = dividends === null ? "" : basisOf(dividends);
    let repurchasesBasis = repurchases === null ? "" : basisOf(repurchases);
    // Una partida sin concepto en ningún ejercicio es cero sólo con evidencia.
    if (dividends === null || repurchases === null) {
      const rolls =
        dividends === null && retainedEarningsRolls(end, yearIncome.value);
      const residual = cleanSurplusResidual(
        end,
        dividendValue.plus(repurchaseValue),
      );
      const surplusCloses =
        residual !== null &&
        residual
          .abs()
          .lessThanOrEqualTo(
            yearIncome.value
              .abs()
              .times(
                parseDecimal(CLEAN_SURPLUS_TOLERANCE, "cleanSurplusTolerance"),
              ),
          );
      if (dividends === null) {
        if (rolls) dividendsBasis = "zero_by_retained_earnings_roll";
        else if (surplusCloses) dividendsBasis = "zero_by_clean_surplus";
        else {
          return { status: "unavailable", reason: "distribution_unsupported" };
        }
      }
      if (repurchases === null) {
        if (surplusCloses) repurchasesBasis = "zero_by_clean_surplus";
        else {
          return { status: "unavailable", reason: "distribution_unsupported" };
        }
      }
    }
    years.push({
      fiscalYearEnd: end,
      commonIncome: yearIncome.value.toString(),
      commonDividends: dividendValue.toString(),
      netRepurchases: repurchaseValue.toString(),
      dividendsBasis,
      repurchasesBasis,
    });
  }
  const payout = computeThreeYearPayout(
    years.map(
      ({
        fiscalYearEnd: end,
        commonIncome,
        commonDividends,
        netRepurchases,
      }) => ({
        fiscalYearEnd: end,
        commonIncome,
        commonDividends,
        netRepurchases,
      }),
    ),
  );
  if (payout.status !== "ready") {
    return { status: "unavailable", reason: "distribution_unsupported" };
  }

  // Diagnósticos: capital regulatorio y calidad de activos.
  const close = instant(fiscalYearEnd);
  const priorClose = instant(priorFiscalYearEnd);
  const accession = report.accessionNumber;
  const year4 = fiscalYearEnd.slice(0, 4);
  const surplus = agreed(
    "us-gaap:StatutoryAccountingPracticesStatutoryCapitalAndSurplusBalance",
    close,
    "usd",
  );
  let regulatoryCapital: string | null = null;
  if (surplus !== null) {
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
    regulatoryCapital = `Capital y superávit estatutario de las aseguradoras: USD ${millions(surplus.value)} millones al cierre ${year4}${priorSurplus === null ? "" : ` (USD ${millions(priorSurplus.value)} millones el previo)`}${capacity === null ? "" : `; disponible para dividendos sin aprobación regulatoria: USD ${millions(capacity.value)} millones`}. El XBRL no publica un requisito, así que no se contrasta. Es capital de las subsidiarias aseguradoras; el patrimonio valuado es el consolidado del grupo, con todos sus negocios (${accession}).`;
  } else {
    const ratio = describeByMember(
      collect("us-gaap:CommonEquityTierOneCapitalRatio", close, "pure", 2),
      percentText,
    );
    const minimum = describeByMember(
      firstNonEmpty([
        collect(
          "us-gaap:BankingRegulationCommonEquityTierOneRiskBasedCapitalRatioCapitalAdequacyMinimum",
          close,
          "pure",
          2,
        ),
        collect(
          "us-gaap:CommonEquityTierOneCapitalRequiredForCapitalAdequacyToRiskWeightedAssets",
          close,
          "pure",
          2,
        ),
      ]),
      percentText,
    );
    const amount = describeByMember(
      collect("us-gaap:CommonEquityTierOneCapital", close, "usd", 2),
      usdText,
    );
    const required = describeByMember(
      collect(
        "us-gaap:CommonEquityTierOneCapitalRequiredForCapitalAdequacy",
        close,
        "usd",
        2,
      ),
      usdText,
    );
    if (ratio !== null || amount !== null) {
      regulatoryCapital = `CET1 al cierre ${year4}: ${[ratio, amount].filter((part) => part !== null).join("; ")}${minimum === null && required === null ? "; el XBRL no publica el mínimo, así que no se contrasta" : `; mínimo publicado: ${[minimum, required].filter((part) => part !== null).join("; ")}`}. Es capital regulatorio del grupo o de sus subsidiarias, según el miembro; no prueba solvencia (${accession}).`;
    }
  }
  if (regulatoryCapital === null) {
    if (!brokerDealer) {
      return { status: "unavailable", reason: "regulatory_capital_missing" };
    }
    regulatoryCapital = `El XBRL del 10-K no publica capital regulatorio que este lector reconozca (CET1 ni capital estatutario); el capital regulatorio —CET1 o net capital de las subsidiarias broker-dealer— no se contrasta (${accession}).`;
  }

  const reserves = describeByMember(
    collect(
      "us-gaap:LiabilityForClaimsAndClaimsAdjustmentExpense",
      close,
      "usd",
    ),
    usdText,
  );
  const allowance = describeByMember(
    firstNonEmpty([
      collect(
        "us-gaap:FinancingReceivableAllowanceForCreditLosses",
        close,
        "usd",
      ),
      collect(
        "us-gaap:FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest",
        close,
        "usd",
      ),
      collect("us-gaap:AllowanceForDoubtfulAccountsReceivable", close, "usd"),
    ]),
    usdText,
  );
  let assetQuality: string;
  if (reserves === null && allowance === null) {
    if (!brokerDealer) {
      return { status: "unavailable", reason: "asset_quality_missing" };
    }
    assetQuality = `El XBRL del 10-K no publica previsiones por pérdidas crediticias que este lector reconozca; la calidad de activos no se contrasta (${accession}).`;
  } else {
    assetQuality = capitalized(
      `${reserves === null ? "" : `pasivo por siniestros y gastos de liquidación: ${reserves}; `}${allowance === null ? "" : `previsión por pérdidas crediticias: ${allowance}; `}no prueba suficiencia de reservas (${accession}).`,
    );
  }

  const base = years[0]!;
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
  const bookFlags = (parentReading: Parent, preferredReading: Preferred) => [
    ...(parentReading.totalLessNci ? ["parent_equity_total_less_nci"] : []),
    `preferred_${preferredReading.basis}`,
  ];
  const zeroFlag = (basis: string) =>
    basis.startsWith("zero_by_") ? [basis] : [];
  const change = book.minus(prior);
  const distributions = parseDecimal(base.commonDividends, "dividends").plus(
    parseDecimal(base.netRepurchases, "repurchases"),
  );
  const yearsText = years
    .map(
      (year) =>
        `${year.fiscalYearEnd.slice(0, 4)}: utilidad ${millions(parseDecimal(year.commonIncome, "income"))}, dividendos ${millions(parseDecimal(year.commonDividends, "dividends"))} (${year.dividendsBasis}), recompras ${millions(parseDecimal(year.netRepurchases, "repurchases"))} (${year.repurchasesBasis})`,
    )
    .join("; ");

  return {
    status: "ready",
    evidence: financialFilingEvidenceSchema.parse({
      version: FINANCIAL_XBRL_EVIDENCE_VERSION,
      fiscalYearEnd,
      commonBook: fact(book, fiscalYearEnd, bookFlags(parent, preferred)),
      priorBook: fact(
        prior,
        priorFiscalYearEnd,
        bookFlags(priorParent, priorPreferred),
      ),
      commonIncome: fact(income.value, fiscalYearEnd, [
        localName(incomeConcept),
        ...(participatingGap === null
          ? []
          : ["participating_allocation_unpublished"]),
      ]),
      commonDividends: fact(
        parseDecimal(base.commonDividends, "dividends"),
        fiscalYearEnd,
        zeroFlag(base.dividendsBasis),
      ),
      netRepurchases: fact(
        parseDecimal(base.netRepurchases, "repurchases"),
        fiscalYearEnd,
        zeroFlag(base.repurchasesBasis),
      ),
      payout: payout.payout.toString(),
      payoutBasis: payout.basis,
      regulatoryCapital,
      assetQuality,
      cleanSurplus:
        `Cambio del patrimonio común: USD ${millions(change)} millones; utilidad común menos dividendos y recompras del ejercicio: USD ${millions(income.value.minus(distributions))} millones${hasPreferred ? `; preferentes restadas: USD ${millions(preferred.value)} millones (USD ${millions(priorPreferred.value)} millones el previo)` : ""}${participatingGap === null ? "" : `; el EPS básico deja USD ${millions(participatingGap)} millones sin explicar, la asignación a valores participantes que el XBRL no publica`}. Payout del trienio ${percent(parseDecimal(payout.basis.ratio, "ratio"))} %${payout.basis.payoutCapped ? ", llevado a 100 %" : ""} (${yearsText}) (${accession}).`.slice(
          0,
          1024,
        ),
      sourceDocumentId: accession,
      availableAt: report.acceptedAt,
    }),
  };
}

function firstNonEmpty(
  maps: readonly ReadonlyMap<string | null, readonly Found[]>[],
): ReadonlyMap<string | null, readonly Found[]> {
  return maps.find((map) => map.size > 0) ?? new Map();
}

function usdText(value: Dec): string {
  return `USD ${millions(value)} millones`;
}

function percentText(value: Dec): string {
  return `${percent(value)} %`;
}

/** El valor sin dimensiones o, por miembro, hasta cuatro valores distintos. */
function describeByMember(
  byMember: ReadonlyMap<string | null, readonly Found[]>,
  format: (value: Dec) => string,
): string | null {
  const plain = byMember.get(null);
  if (plain !== undefined) {
    return plain.length === 1 ? format(plain[0]!.value) : null;
  }
  const entries = [...byMember]
    .filter(([, values]) => values.length === 1)
    .map(
      ([member, values]) =>
        [
          member!
            .split("&")
            .map((part) => part.replace(/^[^=]*=/u, ""))
            .join(" · "),
          values[0]!.value,
        ] as const,
    )
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
    .map(([member, value]) => `${format(value)} (${member})`)
    .join(", ");
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
