import { z } from "zod";

import {
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
} from "./decimal-policy";
import { deriveEmployeeEquity } from "./employee-equity-claim";
import { financialCostOfEquity } from "./excess-return";
import type { ReitAssumptions, ReitInput } from "./reit-input";
import { ValuationPolicyError } from "./valuation-error";

const decimal = engineDecimalSchema;
export const reitComputationSchema = z.object({
  reconciliation: z.object({
    commonNetIncome: decimal,
    ffo: decimal,
    recurringCapex: decimal,
    straightLineRent: decimal,
    affo: decimal,
  }),
  periods: z
    .array(
      z.object({
        periodIndex: z.number().int().min(1).max(20),
        affo: decimal,
        fundedGrowth: decimal,
        retention: decimal,
        growthReinvestment: decimal,
        distributableCash: decimal,
        costOfEquity: decimal,
        discountFactor: decimal,
        presentValue: decimal,
      }),
    )
    .min(1)
    .max(20),
  terminal: z.object({
    affo: decimal,
    retention: decimal,
    growthReinvestment: decimal,
    distributableCash: decimal,
    costOfEquity: decimal,
    terminalValue: decimal,
    presentValue: decimal,
  }),
  presentValueOfDistributions: decimal,
  grossEquityValue: decimal,
  employeeOptionValue: decimal,
  equityValue: decimal,
  shareCount: decimal,
  valuePerShare: decimal,
  nav: z.object({
    forwardNoi: decimal,
    capRate: decimal,
    propertyValue: decimal,
    excessCash: decimal,
    nonPropertyAssets: decimal,
    debt: decimal,
    preferredEquity: decimal,
    noncontrollingInterests: decimal,
    otherLiabilities: decimal,
    corporateCostValue: decimal,
    grossCommonEquity: decimal,
    employeeOptionValue: decimal,
    equityValue: decimal,
    valuePerShare: decimal,
  }),
  /** DCF minus NAV, in valuation currency/share; neither is an average. */
  dcfMinusNavPerShare: decimal,
});

export function reconcileAffo(input: ReitInput) {
  const a = input.affo;
  const value = (key: keyof typeof a) => {
    const fact = a[key];
    if (fact === null || typeof fact !== "object")
      throw new ValuationPolicyError(
        "policy_check_failed",
        "AFFO reconciliation is incomplete.",
        [`affo.${key}`],
      );
    return parseDecimal(fact.value, `affo.${key}`);
  };
  const commonNetIncome = value("commonNetIncome");
  const ffo = commonNetIncome
    .plus(value("realEstateDepreciation"))
    .minus(value("propertySaleGains"))
    .plus(value("realEstateImpairments"))
    .plus(value("jointVentureAdjustment"));
  const recurringCapex = value("recurringCapex");
  const straightLineRent = value("straightLineRent");
  return {
    commonNetIncome,
    ffo,
    recurringCapex,
    straightLineRent,
    affo: ffo.minus(recurringCapex).minus(straightLineRent),
  };
}

/** Internal arithmetic after admission; common cash flow already includes financing. */
export function computeReit(
  input: ReitInput,
  assumptions: ReitAssumptions = input.assumptions,
) {
  const reconciled = reconcileAffo(input);
  const employee = deriveEmployeeEquity({
    ...input.employeeEquity!,
    riskFree: input.risk.riskFree!.value,
  });
  const options = parseDecimal(
    employee.options?.totalValue ?? "0",
    "employeeOptions",
  );
  const shares = parseDecimal(employee.shareCount, "shares");
  let affo = reconciled.affo;
  let discountFactor = ONE;
  let pv = ZERO;
  const periods = assumptions.periods.map((period, index) => {
    const growth = parseDecimal(period.affoGrowth, "affoGrowth");
    const fundedGrowth = parseDecimal(
      assumptions.periods[index + 1]?.affoGrowth ?? assumptions.terminal.growth,
      "fundedGrowth",
    );
    const retention = divide(
      fundedGrowth,
      parseDecimal(period.returnOnNewEquity, "returnOnNewEquity"),
      "retention",
    );
    affo = affo.times(ONE.plus(growth));
    const growthReinvestment = affo.times(retention);
    const distributableCash = affo.minus(growthReinvestment);
    const ke = financialCostOfEquity(input, period.equityBeta);
    discountFactor = discountFactor.times(ONE.plus(ke));
    const presentValue = divide(
      distributableCash,
      discountFactor,
      "presentValue",
    );
    pv = pv.plus(presentValue);
    return {
      periodIndex: index + 1,
      affo: formatDecimal(affo, "affo"),
      fundedGrowth: formatDecimal(fundedGrowth, "fundedGrowth"),
      retention: formatDecimal(retention, "retention"),
      growthReinvestment: formatDecimal(
        growthReinvestment,
        "growthReinvestment",
      ),
      distributableCash: formatDecimal(distributableCash, "cash"),
      costOfEquity: formatDecimal(ke, "ke"),
      discountFactor: formatDecimal(discountFactor, "discountFactor"),
      presentValue: formatDecimal(presentValue, "presentValue"),
    };
  });
  const terminal = assumptions.terminal;
  const g = parseDecimal(terminal.growth, "terminal.growth");
  const ke = financialCostOfEquity(input, terminal.equityBeta);
  const retention = divide(
    g,
    parseDecimal(terminal.returnOnNewEquity, "terminal.returnOnNewEquity"),
    "terminal.retention",
  );
  const nextAffo = affo.times(ONE.plus(g));
  const growthReinvestment = nextAffo.times(retention);
  const terminalCash = nextAffo.minus(growthReinvestment);
  const terminalValue = divide(terminalCash, ke.minus(g), "terminalValue");
  const terminalPv = divide(
    terminalValue,
    discountFactor,
    "terminal.presentValue",
  );
  const grossEquityValue = pv.plus(terminalPv);
  const equityValue = grossEquityValue.minus(options);
  const valuePerShare = divide(equityValue, shares, "valuePerShare");

  const noi = parseDecimal(assumptions.nav.forwardNoi, "nav.forwardNoi");
  const capRate = parseDecimal(assumptions.nav.capRate, "nav.capRate");
  const propertyValue = divide(noi, capRate, "nav.propertyValue");
  const amounts = Object.fromEntries(
    (
      [
        "excessCash",
        "nonPropertyAssets",
        "debt",
        "preferredEquity",
        "noncontrollingInterests",
        "otherLiabilities",
        "corporateCostValue",
      ] as const
    ).map((key) => [key, parseDecimal(input.nav[key]!.value, `nav.${key}`)]),
  );
  const grossCommonEquity = propertyValue
    .plus(amounts.excessCash!)
    .plus(amounts.nonPropertyAssets!)
    .minus(amounts.debt!)
    .minus(amounts.preferredEquity!)
    .minus(amounts.noncontrollingInterests!)
    .minus(amounts.otherLiabilities!)
    .minus(amounts.corporateCostValue!);
  const navEquity = grossCommonEquity.minus(options);
  const navPerShare = divide(navEquity, shares, "nav.valuePerShare");
  return reitComputationSchema.parse({
    reconciliation: Object.fromEntries(
      Object.entries(reconciled).map(([key, value]) => [
        key,
        formatDecimal(value, key),
      ]),
    ),
    periods,
    terminal: {
      affo: formatDecimal(nextAffo, "terminal.affo"),
      retention: formatDecimal(retention, "terminal.retention"),
      growthReinvestment: formatDecimal(
        growthReinvestment,
        "terminal.reinvestment",
      ),
      distributableCash: formatDecimal(terminalCash, "terminal.cash"),
      costOfEquity: formatDecimal(ke, "terminal.ke"),
      terminalValue: formatDecimal(terminalValue, "terminal.value"),
      presentValue: formatDecimal(terminalPv, "terminal.pv"),
    },
    presentValueOfDistributions: formatDecimal(pv, "pv"),
    grossEquityValue: formatDecimal(grossEquityValue, "grossEquityValue"),
    employeeOptionValue: formatDecimal(options, "options"),
    equityValue: formatDecimal(equityValue, "equityValue"),
    shareCount: employee.shareCount,
    valuePerShare: formatDecimal(valuePerShare, "valuePerShare"),
    nav: {
      forwardNoi: assumptions.nav.forwardNoi,
      capRate: assumptions.nav.capRate,
      propertyValue: formatDecimal(propertyValue, "propertyValue"),
      ...Object.fromEntries(
        Object.entries(amounts).map(([key, value]) => [
          key,
          formatDecimal(value, key),
        ]),
      ),
      grossCommonEquity: formatDecimal(grossCommonEquity, "nav.common"),
      employeeOptionValue: formatDecimal(options, "options"),
      equityValue: formatDecimal(navEquity, "nav.equity"),
      valuePerShare: formatDecimal(navPerShare, "nav.perShare"),
    },
    dcfMinusNavPerShare: formatDecimal(
      valuePerShare.minus(navPerShare),
      "dcfMinusNavPerShare",
    ),
  });
}
