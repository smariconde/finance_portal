import type {
  AnnualFundamentals,
  LineItemValue,
} from "../domain/annual-fundamentals";
import {
  companyProfile,
  type CompanyProfile,
  type CompanyProfileInput,
  type ProfileAmount,
} from "../domain/company-profile";
import { formatDecimal, parseDecimal } from "../domain/decimal-policy";
import type { ExcessReturnRun } from "../domain/excess-return-run";
import type { MarketPriceComparison } from "../domain/market-implied";
import type { BridgeItem } from "../domain/valuation-input";
import type { ValuationRun } from "../domain/valuation-run";

const reported = (item: LineItemValue | undefined): ProfileAmount | null =>
  item?.currency === null || item === undefined
    ? null
    : { value: item.value, currency: item.currency };

function freeCashFlow(
  operating: LineItemValue | undefined,
  capex: LineItemValue | undefined,
): ProfileAmount | null {
  if (
    operating === undefined ||
    capex === undefined ||
    operating.currency === null ||
    operating.currency !== capex.currency
  )
    return null;
  return {
    value: formatDecimal(
      parseDecimal(operating.value, "profile.operatingCashFlow").minus(
        parseDecimal(capex.value, "profile.capex"),
      ),
      "profile.freeCashFlow",
    ),
    currency: operating.currency,
  };
}

function claim(item: BridgeItem): string | null {
  if (item.status === "declared_absent") return "0";
  return item.status === "reported" ? item.amount!.value : null;
}

function claimsOf(run: ValuationRun): ProfileAmount | null {
  const { bridge } = run.input;
  const amounts = [bridge.debt, bridge.leaseDebt, bridge.minorityInterest];
  if (
    amounts.some(
      (item) =>
        item.status === "missing" ||
        (item.amount !== null && item.amount.currency !== run.currency),
    )
  )
    return null;
  return {
    value: formatDecimal(
      amounts.reduce(
        (total, item) => total.plus(claim(item)!),
        parseDecimal("0", "profile.zero"),
      ),
      "profile.evClaims",
    ),
    currency: run.currency,
  };
}

function bridgeAmount(
  item: BridgeItem,
  currency: string,
): ProfileAmount | null {
  const value = claim(item);
  return value === null ||
    (item.amount !== null && item.amount.currency !== currency)
    ? null
    : { value, currency };
}

function baseInput(
  run: ValuationRun | ExcessReturnRun,
  series: AnnualFundamentals | null,
  baseFiscalYearEnd: string,
): Omit<
  CompanyProfileInput,
  | "price"
  | "priceDate"
  | "shares"
  | "ebit"
  | "debt"
  | "evClaims"
  | "cash"
  | "runwayCash"
  | "equity"
  | "roe"
  | "costOfEquity"
  | "normalizedEarnings"
  | "normalizedEbitda"
  | "affo"
  | "nav"
> {
  const index =
    series?.fiscalYears.findIndex(
      (year) => year.fiscalYearEnd === baseFiscalYearEnd,
    ) ?? -1;
  const year = index < 0 ? undefined : series?.fiscalYears[index];
  const candidate = index < 0 ? undefined : series?.fiscalYears[index + 1];
  const days =
    year === undefined || candidate === undefined
      ? null
      : (Date.parse(`${year.fiscalYearEnd}T00:00:00Z`) -
          Date.parse(`${candidate.fiscalYearEnd}T00:00:00Z`)) /
        86_400_000;
  const prior =
    days !== null && days >= 350 && days <= 380 ? candidate : undefined;
  return {
    assetProfile: run.assetProfile,
    currency: run.currency,
    fiscalYearEnd: baseFiscalYearEnd,
    revenue: reported(year?.items.revenue),
    previousRevenue: reported(prior?.items.revenue),
    netIncome: reported(year?.items.net_income),
    depreciation: reported(year?.items.depreciation_amortization),
    freeCashFlow: freeCashFlow(
      year?.items.operating_cash_flow,
      year?.items.capital_expenditure,
    ),
    dividends: reported(year?.items.dividends_paid),
    shareBasedCompensation: reported(year?.items.share_based_compensation),
    goodwill: reported(year?.items.goodwill),
    intangibles: reported(year?.items.intangibles),
  };
}

/** This view never changes a stored run or its hashes. */
export function profileOfFcffRun(
  run: ValuationRun,
  series: AnnualFundamentals | null,
  comparison: MarketPriceComparison,
): CompanyProfile {
  const price = comparison.status === "compared" ? comparison.price : null;
  const base = baseInput(run, series, run.input.baseRevenue.asOf);
  const ebit = run.input.normalization.base.ebitAdjusted;
  const debt = bridgeAmount(run.input.bridge.debt, run.currency);
  const normalizedEbit = run.result?.cycleComparison?.normalizedBaseEbit;
  const depreciation = base.depreciation;
  const normalizedEbitda =
    normalizedEbit === undefined ||
    depreciation === null ||
    depreciation.currency !== run.currency
      ? null
      : {
          value: formatDecimal(
            parseDecimal(normalizedEbit, "profile.normalizedEbit").plus(
              parseDecimal(depreciation.value, "profile.depreciation"),
            ),
            "profile.normalizedEbitda",
          ),
          currency: run.currency,
        };

  return companyProfile({
    ...base,
    priceDate: price?.marketDate ?? null,
    price:
      price === null ? null : { value: price.close, currency: price.currency },
    shares:
      price === null ? null : run.input.employeeEquity.sharesOutstanding.value,
    ebit: ebit === null ? null : { value: ebit, currency: run.currency },
    debt,
    evClaims: claimsOf(run),
    cash: bridgeAmount(run.input.bridge.excessCash, run.currency),
    runwayCash: reported(
      series?.fiscalYears.find(
        (year) => year.fiscalYearEnd === base.fiscalYearEnd,
      )?.items.cash,
    ),
    equity: reported(
      series?.fiscalYears.find(
        (year) => year.fiscalYearEnd === base.fiscalYearEnd,
      )?.items.equity,
    ),
    roe: null,
    costOfEquity: null,
    normalizedEarnings: null,
    normalizedEbitda,
    affo: null,
    nav: null,
  });
}

export function profileOfFinancialRun(
  run: ExcessReturnRun,
  series: AnnualFundamentals | null,
  close: {
    readonly marketDate: string;
    readonly close: string;
    readonly currency: string;
  } | null,
  comparable: boolean,
): CompanyProfile {
  const price = comparable ? close : null;
  return companyProfile({
    ...baseInput(run, series, run.input.commonBookEquity?.asOf ?? run.asOf),
    priceDate: price?.marketDate ?? null,
    price:
      price === null ? null : { value: price.close, currency: price.currency },
    shares:
      price === null
        ? null
        : (run.input.employeeEquity?.sharesOutstanding.value ?? null),
    ebit: null,
    debt: null,
    evClaims: null,
    cash: null,
    runwayCash: null,
    equity:
      run.input.commonBookEquity === null
        ? null
        : {
            value: run.input.commonBookEquity.value,
            currency: run.input.commonBookEquity.currency,
          },
    roe: run.input.derivedFinancial?.roe ?? null,
    costOfEquity: run.result?.base.periods[0]?.costOfEquity ?? null,
    normalizedEarnings: null,
    normalizedEbitda: null,
    affo: null,
    nav: null,
  });
}
