import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  type Dec,
  divide,
  engineDecimalSchema,
  ONE,
  parseDecimal,
  ZERO,
} from "./decimal-policy";

/**
 * Payout de un trienio con tope en uno (`F6-53`, decisión del owner del
 * 2026-11-25).
 *
 * Un banco de inversión puede devolver más que su utilidad en un año —GS 103 %
 * en 2025, SCHW 110 %— y un año con recompras grandes no es la política que el
 * modelo proyecta diez años. El payout es la suma de dividendos comunes y
 * recompras de los tres ejercicios que publica el 10-K sobre la suma de su
 * utilidad común, y si pasa de uno se lleva a uno y se nombra
 * (`payoutCapped`): más que toda la utilidad achicaría el patrimonio sin fin.
 * Una suma de utilidades no positiva no tiene payout.
 */
export const FINANCIAL_PAYOUT_VERSION = "financial-payout-three-years-1.0.0";

export const PAYOUT_YEARS = 3;

export const payoutYearSchema = z.strictObject({
  fiscalYearEnd: calendarDateSchema,
  commonIncome: engineDecimalSchema,
  commonDividends: engineDecimalSchema,
  netRepurchases: engineDecimalSchema,
});

export const payoutBasisSchema = z.strictObject({
  version: z.literal(FINANCIAL_PAYOUT_VERSION),
  /** Del ejercicio base hacia atrás. */
  years: z.array(payoutYearSchema).length(PAYOUT_YEARS),
  /** Distribuciones del trienio sobre su utilidad, antes del tope. */
  ratio: engineDecimalSchema,
  payoutCapped: z.boolean(),
});

export type PayoutYear = z.infer<typeof payoutYearSchema>;
export type PayoutBasis = z.infer<typeof payoutBasisSchema>;

export type PayoutResult =
  | {
      readonly status: "ready";
      readonly payout: Dec;
      readonly basis: PayoutBasis;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "payout_history_missing"
        | "non_positive_income"
        | "negative_distribution";
    };

function dec(value: string, path: string): Dec {
  return parseDecimal(value, path);
}

export function computeThreeYearPayout(
  years: readonly PayoutYear[],
): PayoutResult {
  if (years.length !== PAYOUT_YEARS) {
    return { status: "unavailable", reason: "payout_history_missing" };
  }
  let income = ZERO;
  let distributions = ZERO;
  for (const [index, year] of years.entries()) {
    const dividends = dec(year.commonDividends, `years.${index}.dividends`);
    const repurchases = dec(year.netRepurchases, `years.${index}.repurchases`);
    if (dividends.lt(ZERO) || repurchases.lt(ZERO)) {
      return { status: "unavailable", reason: "negative_distribution" };
    }
    income = income.plus(dec(year.commonIncome, `years.${index}.income`));
    distributions = distributions.plus(dividends).plus(repurchases);
  }
  if (!income.gt(ZERO)) {
    return { status: "unavailable", reason: "non_positive_income" };
  }
  const ratio = divide(distributions, income, "payoutRatio");
  const payoutCapped = ratio.gt(ONE);
  return {
    status: "ready",
    payout: payoutCapped ? ONE : ratio,
    basis: payoutBasisSchema.parse({
      version: FINANCIAL_PAYOUT_VERSION,
      years: years.map((year) => ({ ...year })),
      ratio: ratio.toString(),
      payoutCapped,
    }),
  };
}

/** Lo que el policy check recalcula: el payout que la base congelada implica. */
export function payoutOfBasis(basis: PayoutBasis): Dec | null {
  const result = computeThreeYearPayout(basis.years);
  return result.status === "ready" &&
    result.basis.ratio === basis.ratio &&
    result.basis.payoutCapped === basis.payoutCapped
    ? result.payout
    : null;
}
