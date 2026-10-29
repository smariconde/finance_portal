import { z } from "zod";

import { calendarDaysBetween } from "@/modules/temporal/domain/calendar-date";
import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

import {
  engineDecimalSchema,
  formatDecimal,
  ONE,
  parseDecimal,
  ZERO,
} from "./decimal-policy";

/** Screening rule approved for F6-21; the four observations span three years. */
export const DERIVED_GROWTH_TRAJECTORY_VERSION =
  "derived-growth-trajectory-1.0.0";
export const GROWTH_EXPLICIT_YEARS = 10;
export const GROWTH_HIGH_YEARS = 3;
export const GROWTH_MARGIN_CONVERGENCE_YEARS = 5;

export const growthRevenueHistorySchema = z
  .array(
    z.object({
      fiscalYearEnd: calendarDateSchema,
      value: engineDecimalSchema,
    }),
  )
  .length(4);

export const derivedGrowthTrajectorySchema = z.object({
  version: z.literal(DERIVED_GROWTH_TRAJECTORY_VERSION),
  revenueHistory: growthRevenueHistorySchema,
  terminalGrowth: engineDecimalSchema,
  threeYearCagr: engineDecimalSchema,
  initialRevenueGrowth: engineDecimalSchema,
  explicitYears: z.literal(GROWTH_EXPLICIT_YEARS),
  highGrowthYears: z.literal(GROWTH_HIGH_YEARS),
  marginConvergenceYears: z.literal(GROWTH_MARGIN_CONVERGENCE_YEARS),
});

export type DerivedGrowthTrajectory = z.infer<
  typeof derivedGrowthTrajectorySchema
>;

export type GrowthTrajectoryResult =
  | { readonly status: "ready"; readonly trajectory: DerivedGrowthTrajectory }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "revenue_history_insufficient"
        | "revenue_history_non_positive"
        | "revenue_history_discontinuous"
        | "terminal_growth_invalid"
        | "growth_below_terminal";
    };

/** Most recent fiscal year first. A missing year or invalid amount refuses. */
export function deriveGrowthTrajectory(
  history: readonly { fiscalYearEnd: string; value: string }[],
  terminalGrowth: string,
): GrowthTrajectoryResult {
  if (history.length < 4)
    return { status: "unavailable", reason: "revenue_history_insufficient" };

  const selected = history.slice(0, 4);
  if (!growthRevenueHistorySchema.safeParse(selected).success)
    return { status: "unavailable", reason: "revenue_history_non_positive" };

  const values = selected.map((year) => parseDecimal(year.value, "revenue"));
  if (values.some((value) => !value.gt(ZERO)))
    return { status: "unavailable", reason: "revenue_history_non_positive" };

  for (let index = 0; index < 3; index += 1) {
    const days = calendarDaysBetween(
      selected[index + 1]!.fiscalYearEnd,
      selected[index]!.fiscalYearEnd,
    );
    if (days < 357 || days > 373)
      return { status: "unavailable", reason: "revenue_history_discontinuous" };
  }

  if (!engineDecimalSchema.safeParse(terminalGrowth).success)
    return { status: "unavailable", reason: "terminal_growth_invalid" };
  const terminal = parseDecimal(terminalGrowth, "terminalGrowth");
  if (terminal.lt(ZERO) || terminal.gt(ONE))
    return { status: "unavailable", reason: "terminal_growth_invalid" };

  const cagr = values[0]!
    .dividedBy(values[3]!)
    .pow(ONE.dividedBy(3))
    .minus(ONE);
  const ceiling = parseDecimal("0.30", "growthCeiling");
  const initial = cagr.lt(ceiling) ? cagr : ceiling;
  if (initial.lt(terminal))
    return { status: "unavailable", reason: "growth_below_terminal" };

  return {
    status: "ready",
    trajectory: derivedGrowthTrajectorySchema.parse({
      version: DERIVED_GROWTH_TRAJECTORY_VERSION,
      revenueHistory: selected,
      terminalGrowth,
      threeYearCagr: formatDecimal(cagr, "threeYearCagr"),
      initialRevenueGrowth: formatDecimal(initial, "initialRevenueGrowth"),
      explicitYears: GROWTH_EXPLICIT_YEARS,
      highGrowthYears: GROWTH_HIGH_YEARS,
      marginConvergenceYears: GROWTH_MARGIN_CONVERGENCE_YEARS,
    }),
  };
}
