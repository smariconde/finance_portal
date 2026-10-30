import { z } from "zod";

import {
  type Dec,
  divide,
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
} from "./decimal-policy";
import { deriveEmployeeEquity } from "./employee-equity-claim";
import { financialCostOfEquity } from "./excess-return";
import {
  REIT_OPTIONAL_AFFO_COMPONENTS,
  type ReitAssumptions,
  type ReitInput,
  type ReitOptionalAffoComponent,
} from "./reit-input";
import { ValuationPolicyError } from "./valuation-error";

const decimal = engineDecimalSchema;
export const reitComputationSchema = z.object({
  reconciliation: z.object({
    commonNetIncome: decimal,
    ffo: decimal,
    recurringCapex: decimal,
    straightLineRent: decimal,
    affo: decimal,
    /**
     * `affo-nav-1.1.0`: components the filer did not tag, left unapplied and
     * named; never read as zero. Absent under `1.0.0`.
     */
    notAdjusted: z
      .array(z.enum(REIT_OPTIONAL_AFFO_COMPONENTS))
      .max(REIT_OPTIONAL_AFFO_COMPONENTS.length)
      .optional(),
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
  /** `null` when the NAV is declared absent (`affo-nav-1.1.0`). */
  nav: z
    .object({
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
    })
    .nullable(),
  /** DCF minus NAV, in valuation currency/share; neither is an average. */
  dcfMinusNavPerShare: decimal.nullable(),
});

/**
 * Components that `affo-nav-1.1.0` leaves unapplied because the filer did not
 * tag them; the derivation names each one.
 */
export function reitNotAdjusted(
  input: Pick<ReitInput, "affo" | "derivedReit">,
): ReitOptionalAffoComponent[] {
  const basis = input.derivedReit?.affoBasis;
  return basis === undefined
    ? []
    : REIT_OPTIONAL_AFFO_COMPONENTS.filter(
        (key) => basis[key] === null && input.affo[key] === null,
      );
}

export function reconcileAffo(input: Pick<ReitInput, "affo" | "derivedReit">) {
  const a = input.affo;
  const notAdjusted = reitNotAdjusted(input);
  const value = (key: keyof typeof a) => {
    // Un componente no etiquetado no se aplica: no es un cero, es un ajuste
    // que esta corrida no hizo, y la corrida lo nombra.
    if ((notAdjusted as string[]).includes(key)) return ZERO;
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
    notAdjusted: input.derivedReit === undefined ? undefined : notAdjusted,
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

  const nav =
    assumptions.nav === null || input.nav === null
      ? null
      : computeNav(input.nav, assumptions.nav, options, shares);
  return reitComputationSchema.parse({
    reconciliation: {
      commonNetIncome: formatDecimal(reconciled.commonNetIncome, "ni"),
      ffo: formatDecimal(reconciled.ffo, "ffo"),
      recurringCapex: formatDecimal(reconciled.recurringCapex, "capex"),
      straightLineRent: formatDecimal(reconciled.straightLineRent, "slr"),
      affo: formatDecimal(reconciled.affo, "affo"),
      ...(reconciled.notAdjusted === undefined
        ? {}
        : { notAdjusted: reconciled.notAdjusted }),
    },
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
    nav: nav?.reading ?? null,
    dcfMinusNavPerShare:
      nav === null
        ? null
        : formatDecimal(
            valuePerShare.minus(nav.perShare),
            "dcfMinusNavPerShare",
          ),
  });
}

function computeNav(
  claims: NonNullable<ReitInput["nav"]>,
  navAssumptions: NonNullable<ReitAssumptions["nav"]>,
  options: Dec,
  shares: Dec,
) {
  const noi = parseDecimal(navAssumptions.forwardNoi, "nav.forwardNoi");
  const capRate = parseDecimal(navAssumptions.capRate, "nav.capRate");
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
    ).map((key) => [key, parseDecimal(claims[key]!.value, `nav.${key}`)]),
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
  const perShare = divide(navEquity, shares, "nav.valuePerShare");
  return {
    perShare,
    reading: {
      forwardNoi: navAssumptions.forwardNoi,
      capRate: navAssumptions.capRate,
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
      valuePerShare: formatDecimal(perShare, "nav.perShare"),
    },
  };
}
