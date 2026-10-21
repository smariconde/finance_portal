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
import type {
  ExcessReturnInput,
  FinancialAssumptions,
} from "./excess-return-input";
import { ValuationPolicyError } from "./valuation-error";

export const excessReturnPeriodSchema = z.object({
  periodIndex: z.number().int().min(1).max(20),
  beginningBookEquity: engineDecimalSchema,
  netIncome: engineDecimalSchema,
  distributions: engineDecimalSchema,
  retainedEarnings: engineDecimalSchema,
  endingBookEquity: engineDecimalSchema,
  costOfEquity: engineDecimalSchema,
  equityCharge: engineDecimalSchema,
  excessReturn: engineDecimalSchema,
  discountFactor: engineDecimalSchema,
  presentValue: engineDecimalSchema,
});

export const excessReturnComputationSchema = z.object({
  periods: z.array(excessReturnPeriodSchema).min(1).max(20),
  terminal: z.object({
    beginningBookEquity: engineDecimalSchema,
    netIncome: engineDecimalSchema,
    costOfEquity: engineDecimalSchema,
    retention: engineDecimalSchema,
    payout: engineDecimalSchema,
    excessReturn: engineDecimalSchema,
    terminalValue: engineDecimalSchema,
    presentValue: engineDecimalSchema,
  }),
  bookEquity: engineDecimalSchema,
  presentValueOfExcessReturns: engineDecimalSchema,
  grossEquityValue: engineDecimalSchema,
  employeeOptionValue: engineDecimalSchema,
  equityValue: engineDecimalSchema,
  shareCount: engineDecimalSchema,
  valuePerShare: engineDecimalSchema,
});

export type ExcessReturnComputation = z.infer<
  typeof excessReturnComputationSchema
>;

export function financialCostOfEquity(
  input: Pick<ExcessReturnInput, "risk">,
  beta: string,
) {
  const { riskFree, matureErp, countryRiskPremium } = input.risk;
  if (riskFree === null || matureErp === null || countryRiskPremium === null) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Dated equity risk components are required.",
      ["risk"],
    );
  }
  return parseDecimal(riskFree.value, "risk.riskFree")
    .plus(
      parseDecimal(beta, "equityBeta").times(
        parseDecimal(matureErp.value, "risk.matureErp"),
      ),
    )
    .plus(parseDecimal(countryRiskPremium.value, "risk.countryRiskPremium"));
}

/** Internal arithmetic, after policy admission. Beginning book is never advanced by g. */
export function computeExcessReturn(
  input: ExcessReturnInput,
  assumptions: FinancialAssumptions = input.assumptions,
): ExcessReturnComputation {
  if (
    input.commonBookEquity === null ||
    input.employeeEquity === null ||
    input.risk.riskFree === null
  ) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      "Common book and employee equity are required.",
      ["commonBookEquity", "employeeEquity"],
    );
  }
  const bookEquity = parseDecimal(
    input.commonBookEquity.value,
    "commonBookEquity",
  );
  let book = bookEquity;
  let cumulativeDiscount = ONE;
  let pv = ZERO;
  const periods = assumptions.periods.map((period, index) => {
    const costOfEquity = financialCostOfEquity(input, period.equityBeta);
    const income = book.times(parseDecimal(period.roe, "roe"));
    const distributions = income.times(parseDecimal(period.payout, "payout"));
    const retained = income.minus(distributions);
    const charge = book.times(costOfEquity);
    const excess = income.minus(charge);
    cumulativeDiscount = cumulativeDiscount.times(ONE.plus(costOfEquity));
    const discount = divide(ONE, cumulativeDiscount, "discountFactor");
    const presentValue = excess.times(discount);
    pv = pv.plus(presentValue);
    const ending = book.plus(retained);
    const result = {
      periodIndex: index + 1,
      beginningBookEquity: formatDecimal(book, "beginningBookEquity"),
      netIncome: formatDecimal(income, "netIncome"),
      distributions: formatDecimal(distributions, "distributions"),
      retainedEarnings: formatDecimal(retained, "retainedEarnings"),
      endingBookEquity: formatDecimal(ending, "endingBookEquity"),
      costOfEquity: formatDecimal(costOfEquity, "costOfEquity"),
      equityCharge: formatDecimal(charge, "equityCharge"),
      excessReturn: formatDecimal(excess, "excessReturn"),
      discountFactor: formatDecimal(discount, "discountFactor"),
      presentValue: formatDecimal(presentValue, "presentValue"),
    };
    book = ending;
    return result;
  });
  const ke = financialCostOfEquity(input, assumptions.terminal.equityBeta);
  const roe = parseDecimal(assumptions.terminal.roe, "terminal.roe");
  const growth = parseDecimal(assumptions.terminal.growth, "terminal.growth");
  const retention = divide(growth, roe, "terminal.retention");
  const income = book.times(roe);
  const excess = book.times(roe.minus(ke));
  const terminalValue = divide(excess, ke.minus(growth), "terminal.value");
  const terminalPv = divide(
    terminalValue,
    cumulativeDiscount,
    "terminal.presentValue",
  );
  const gross = bookEquity.plus(pv).plus(terminalPv);
  const employee = deriveEmployeeEquity({
    ...input.employeeEquity,
    riskFree: input.risk.riskFree.value,
  });
  const options = parseDecimal(
    employee.options?.totalValue ?? "0",
    "employeeOptions",
  );
  const equity = gross.minus(options);
  return excessReturnComputationSchema.parse({
    periods,
    terminal: {
      beginningBookEquity: formatDecimal(book, "terminal.beginningBookEquity"),
      netIncome: formatDecimal(income, "terminal.netIncome"),
      costOfEquity: formatDecimal(ke, "terminal.costOfEquity"),
      retention: formatDecimal(retention, "terminal.retention"),
      payout: formatDecimal(ONE.minus(retention), "terminal.payout"),
      excessReturn: formatDecimal(excess, "terminal.excessReturn"),
      terminalValue: formatDecimal(terminalValue, "terminal.terminalValue"),
      presentValue: formatDecimal(terminalPv, "terminal.presentValue"),
    },
    bookEquity: formatDecimal(bookEquity, "bookEquity"),
    presentValueOfExcessReturns: formatDecimal(
      pv,
      "presentValueOfExcessReturns",
    ),
    grossEquityValue: formatDecimal(gross, "grossEquityValue"),
    employeeOptionValue: formatDecimal(options, "employeeOptionValue"),
    equityValue: formatDecimal(equity, "equityValue"),
    shareCount: employee.shareCount,
    valuePerShare: formatDecimal(
      divide(
        equity,
        parseDecimal(employee.shareCount, "shareCount"),
        "valuePerShare",
      ),
      "valuePerShare",
    ),
  });
}
