import type { AssetProfile } from "./asset-profile";
import {
  divide,
  formatDecimal,
  parseDecimal,
  ZERO,
  type Dec,
} from "./decimal-policy";

/** Multiples de una corrida, siempre calculados sobre el mismo corte. */
export const COMPANY_PROFILE_VERSION = "company-profile-1.0.0";

export type ProfileNullReason =
  | "not_reported"
  | "no_comparable_close"
  | "currency_mismatch"
  | "non_positive_denominator"
  | "non_positive_market_value"
  | "not_applicable"
  | "cycle_earnings_unavailable"
  | "affo_nav_unavailable";

export type ProfileMetric = {
  readonly key: string;
  readonly label: string;
  readonly formula: string;
  readonly status: "value" | "null";
  readonly value: string | null;
  readonly reason: ProfileNullReason | null;
  readonly unit: "multiple" | "percent" | "years";
};

export type ProfileAmount = {
  readonly value: string;
  readonly currency: string;
};

export type CompanyProfileInput = {
  readonly assetProfile: AssetProfile;
  readonly currency: string;
  readonly fiscalYearEnd: string;
  readonly priceDate: string | null;
  readonly price: ProfileAmount | null;
  readonly shares: string | null;
  readonly revenue: ProfileAmount | null;
  readonly previousRevenue: ProfileAmount | null;
  readonly netIncome: ProfileAmount | null;
  readonly ebit: ProfileAmount | null;
  readonly depreciation: ProfileAmount | null;
  readonly freeCashFlow: ProfileAmount | null;
  readonly dividends: ProfileAmount | null;
  readonly shareBasedCompensation: ProfileAmount | null;
  readonly equity: ProfileAmount | null;
  readonly goodwill: ProfileAmount | null;
  readonly intangibles: ProfileAmount | null;
  readonly cash: ProfileAmount | null;
  readonly runwayCash: ProfileAmount | null;
  readonly debt: ProfileAmount | null;
  /** Deuda, leases y minoritarios del puente: mismo EV que peer-context. */
  readonly evClaims: ProfileAmount | null;
  readonly roe: string | null;
  readonly costOfEquity: string | null;
  readonly normalizedEarnings: ProfileAmount | null;
  readonly normalizedEbitda: ProfileAmount | null;
  readonly affo: ProfileAmount | null;
  readonly nav: ProfileAmount | null;
};

export type CompanyProfile = {
  readonly version: typeof COMPANY_PROFILE_VERSION;
  readonly assetProfile: AssetProfile;
  readonly currency: string;
  readonly fiscalYearEnd: string;
  readonly priceDate: string | null;
  readonly metrics: readonly ProfileMetric[];
};

type AmountKey = keyof Pick<
  CompanyProfileInput,
  | "revenue"
  | "previousRevenue"
  | "netIncome"
  | "ebit"
  | "depreciation"
  | "freeCashFlow"
  | "dividends"
  | "shareBasedCompensation"
  | "equity"
  | "goodwill"
  | "intangibles"
  | "cash"
  | "runwayCash"
  | "debt"
  | "evClaims"
  | "normalizedEarnings"
  | "normalizedEbitda"
  | "affo"
  | "nav"
>;

function metric(
  key: string,
  label: string,
  formula: string,
  unit: ProfileMetric["unit"],
  compute: () => Dec | ProfileNullReason,
): ProfileMetric {
  const result = compute();
  return typeof result === "string"
    ? { key, label, formula, unit, status: "null", value: null, reason: result }
    : {
        key,
        label,
        formula,
        unit,
        status: "value",
        value: formatDecimal(result, `profile.${key}`),
        reason: null,
      };
}

/** Missing and a currency mismatch are different claims. */
function amount(
  input: CompanyProfileInput,
  key: AmountKey,
): Dec | ProfileNullReason {
  const found = input[key];
  if (found === null) return "not_reported";
  if (found.currency !== input.currency) return "currency_mismatch";
  return parseDecimal(found.value, `profile.${key}`);
}

function marketCap(input: CompanyProfileInput): Dec | ProfileNullReason {
  if (input.price === null || input.shares === null || input.priceDate === null)
    return "no_comparable_close";
  if (input.price.currency !== input.currency) return "currency_mismatch";
  const price = parseDecimal(input.price.value, "profile.price");
  const shares = parseDecimal(input.shares, "profile.shares");
  if (!price.gt(ZERO) || !shares.gt(ZERO)) return "non_positive_market_value";
  return price.times(shares);
}

function ratio(
  numerator: Dec | ProfileNullReason,
  denominator: Dec | ProfileNullReason,
): Dec | ProfileNullReason {
  if (typeof numerator === "string") return numerator;
  if (typeof denominator === "string") return denominator;
  if (!denominator.gt(ZERO)) return "non_positive_denominator";
  return divide(numerator, denominator, "profile.denominator");
}

function enterpriseValue(input: CompanyProfileInput): Dec | ProfileNullReason {
  const cap = marketCap(input);
  const claims = amount(input, "evClaims");
  const cash = amount(input, "cash");
  if (typeof cap === "string") return cap;
  if (typeof claims === "string") return claims;
  if (typeof cash === "string") return cash;
  const result = cap.plus(claims).minus(cash);
  return result.gt(ZERO) ? result : "non_positive_market_value";
}

function plus(
  left: Dec | ProfileNullReason,
  right: Dec | ProfileNullReason,
): Dec | ProfileNullReason {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  return left.plus(right);
}

function growth(input: CompanyProfileInput): Dec | ProfileNullReason {
  const revenue = amount(input, "revenue");
  const previous = amount(input, "previousRevenue");
  const result = ratio(revenue, previous);
  return typeof result === "string" ? result : result.minus(1);
}

/** Rule of 40 uses reported annual revenue growth + reported FCF margin. */
export function companyProfile(input: CompanyProfileInput): CompanyProfile {
  const cap = () => marketCap(input);
  const ev = () => enterpriseValue(input);
  const a = (key: AmountKey) => amount(input, key);
  const percent = (value: Dec | ProfileNullReason) =>
    typeof value === "string" ? value : value.times(100);
  const m = (
    key: string,
    label: string,
    formula: string,
    unit: ProfileMetric["unit"],
    compute: () => Dec | ProfileNullReason,
  ) => metric(key, label, formula, unit, compute);
  let metrics: ProfileMetric[];

  switch (input.assetProfile) {
    case "high_growth":
      metrics = [
        m("ev_sales", "EV / ventas", "EV / ventas reportadas", "multiple", () =>
          ratio(ev(), a("revenue")),
        ),
        m(
          "rule_40",
          "Rule of 40",
          "Crecimiento anual de ventas + margen FCF",
          "percent",
          () =>
            percent(
              plus(growth(input), ratio(a("freeCashFlow"), a("revenue"))),
            ),
        ),
        m("fcf_margin", "Margen FCF", "FCF reportado / ventas", "percent", () =>
          percent(ratio(a("freeCashFlow"), a("revenue"))),
        ),
        m(
          "sbc_sales",
          "SBC / ventas",
          "Compensación en acciones / ventas",
          "percent",
          () => percent(ratio(a("shareBasedCompensation"), a("revenue"))),
        ),
      ];
      break;
    case "loss_making":
      metrics = [
        m("ev_sales", "EV / ventas", "EV / ventas reportadas", "multiple", () =>
          ratio(ev(), a("revenue")),
        ),
        m(
          "cash_runway",
          "Caja / consumo anual",
          "Caja / |FCF negativo|; años",
          "years",
          () => {
            const cash = a("runwayCash");
            const fcf = a("freeCashFlow");
            if (typeof cash === "string") return cash;
            if (typeof fcf === "string") return fcf;
            return fcf.lt(ZERO) ? ratio(cash, fcf.negated()) : "not_applicable";
          },
        ),
      ];
      break;
    case "cyclical":
    case "commodity":
      metrics = [
        m(
          "cycle_pe",
          "P/E de ciclo",
          "Capitalización / utilidad normalizada del ciclo",
          "multiple",
          () =>
            input.normalizedEarnings === null
              ? "cycle_earnings_unavailable"
              : ratio(cap(), a("normalizedEarnings")),
        ),
        m(
          "cycle_ev_ebitda",
          "EV / EBITDA de ciclo",
          "EV / EBITDA normalizado del ciclo",
          "multiple",
          () =>
            input.normalizedEbitda === null
              ? "cycle_earnings_unavailable"
              : ratio(ev(), a("normalizedEbitda")),
        ),
        m(
          "pb",
          "P/B",
          "Capitalización / patrimonio reportado",
          "multiple",
          () => ratio(cap(), a("equity")),
        ),
      ];
      break;
    case "bank":
    case "insurer":
      metrics = [
        m("pb", "P/B", "Capitalización / patrimonio común", "multiple", () =>
          ratio(cap(), a("equity")),
        ),
        m(
          "ptbv",
          "P/TBV",
          "Capitalización / (patrimonio común − goodwill − intangibles)",
          "multiple",
          () => {
            const equity = a("equity");
            const goodwill = a("goodwill");
            const intangible = a("intangibles");
            if (typeof equity === "string") return equity;
            if (typeof goodwill === "string") return goodwill;
            if (typeof intangible === "string") return intangible;
            return ratio(cap(), equity.minus(goodwill).minus(intangible));
          },
        ),
        m(
          "roe",
          "ROE",
          "Utilidad común / patrimonio común medio",
          "percent",
          () =>
            input.roe === null
              ? "not_reported"
              : percent(parseDecimal(input.roe, "profile.roe")),
        ),
        m(
          "cost_of_equity",
          "Costo de equity",
          "Costo de equity del primer período de la corrida",
          "percent",
          () =>
            input.costOfEquity === null
              ? "not_reported"
              : percent(
                  parseDecimal(input.costOfEquity, "profile.costOfEquity"),
                ),
        ),
        m(
          "roe_spread",
          "ROE − costo de equity",
          "ROE reportado derivado − costo de equity",
          "percent",
          () =>
            input.roe === null || input.costOfEquity === null
              ? "not_reported"
              : percent(
                  parseDecimal(input.roe, "profile.roe").minus(
                    parseDecimal(input.costOfEquity, "profile.costOfEquity"),
                  ),
                ),
        ),
      ];
      break;
    case "reit":
      metrics = [
        m(
          "p_affo",
          "P/AFFO",
          "Capitalización / AFFO común conciliado",
          "multiple",
          () =>
            input.affo === null
              ? "affo_nav_unavailable"
              : ratio(cap(), a("affo")),
        ),
        m("p_nav", "P/NAV", "Capitalización / NAV de equity", "multiple", () =>
          input.nav === null ? "affo_nav_unavailable" : ratio(cap(), a("nav")),
        ),
        m(
          "dividend_yield",
          "Rendimiento por dividendos",
          "Dividendos pagados / capitalización",
          "percent",
          () => percent(ratio(a("dividends"), cap())),
        ),
      ];
      break;
    case "non_financial_mature":
      metrics = [
        m(
          "pe",
          "P/E",
          "Capitalización / utilidad neta reportada",
          "multiple",
          () => ratio(cap(), a("netIncome")),
        ),
        m(
          "ev_ebit",
          "EV / EBIT",
          "EV / EBIT ajustado de la corrida",
          "multiple",
          () => ratio(ev(), a("ebit")),
        ),
        m(
          "fcf_yield",
          "Rendimiento FCF",
          "FCF reportado / capitalización",
          "percent",
          () => percent(ratio(a("freeCashFlow"), cap())),
        ),
        m("p_fcf", "P/FCF", "Capitalización / FCF reportado", "multiple", () =>
          ratio(cap(), a("freeCashFlow")),
        ),
        m(
          "dividend_yield",
          "Rendimiento por dividendos",
          "Dividendos pagados / capitalización",
          "percent",
          () => percent(ratio(a("dividends"), cap())),
        ),
        m(
          "payout",
          "Payout",
          "Dividendos pagados / utilidad neta",
          "percent",
          () => percent(ratio(a("dividends"), a("netIncome"))),
        ),
        m(
          "net_debt_ebitda",
          "Deuda neta / EBITDA",
          "(Deuda − caja excedente) / (EBIT ajustado + D&A)",
          "multiple",
          () => {
            const debt = a("debt");
            const cash = a("cash");
            if (typeof debt === "string") return debt;
            if (typeof cash === "string") return cash;
            return ratio(debt.minus(cash), plus(a("ebit"), a("depreciation")));
          },
        ),
      ];
      break;
    default:
      metrics = [];
  }

  return {
    version: COMPANY_PROFILE_VERSION,
    assetProfile: input.assetProfile,
    currency: input.currency,
    fiscalYearEnd: input.fiscalYearEnd,
    priceDate: input.priceDate,
    metrics,
  };
}
