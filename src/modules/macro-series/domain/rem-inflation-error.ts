import { z } from "zod";

import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

export const REM_INFLATION_ERROR_VERSION = "rem-inflation-error-1.0.0";

const decimal = createDecimalOperations((code) => new Error(code));

export type RemInflationError =
  | {
      readonly status: "computed";
      readonly targetMonth: string;
      /** Observed monthly IPC change minus the REM median, in percentage points. */
      readonly errorPp: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "missing_forecast"
        | "missing_actual"
        | "period_mismatch"
        | "unit_mismatch"
        | "not_yet_known"
        | "forecast_after_actual"
        | "invalid_value";
    };

export function remInflationError(input: {
  readonly knownAt: string;
  readonly forecast: {
    readonly targetMonth: string;
    readonly medianPercent: string | null;
    readonly availableAt: string;
    readonly unit: string;
  } | null;
  readonly actual: {
    readonly targetMonth: string;
    readonly monthlyPercent: string | null;
    readonly availableAt: string;
    readonly unit: string;
  } | null;
}): RemInflationError {
  z.iso.datetime({ offset: true }).parse(input.knownAt);
  if (input.forecast === null || input.forecast.medianPercent === null)
    return { status: "unavailable", reason: "missing_forecast" };
  if (input.actual === null || input.actual.monthlyPercent === null)
    return { status: "unavailable", reason: "missing_actual" };
  if (input.forecast.targetMonth !== input.actual.targetMonth)
    return { status: "unavailable", reason: "period_mismatch" };
  if (
    input.forecast.unit !== "percent_monthly" ||
    input.actual.unit !== "percent_monthly"
  )
    return { status: "unavailable", reason: "unit_mismatch" };
  for (const date of [input.forecast.availableAt, input.actual.availableAt])
    z.iso.datetime({ offset: true }).parse(date);
  const knownMs = Date.parse(input.knownAt);
  const forecastMs = Date.parse(input.forecast.availableAt);
  const actualMs = Date.parse(input.actual.availableAt);
  if (forecastMs > knownMs || actualMs > knownMs)
    return { status: "unavailable", reason: "not_yet_known" };
  if (forecastMs >= actualMs)
    return { status: "unavailable", reason: "forecast_after_actual" };
  try {
    const observed = decimal.parseDecimal(
      input.actual.monthlyPercent,
      "actual.monthlyPercent",
    );
    const forecast = decimal.parseDecimal(
      input.forecast.medianPercent,
      "forecast.medianPercent",
    );
    return {
      status: "computed",
      targetMonth: input.actual.targetMonth,
      errorPp: decimal.formatDecimal(
        decimal.assertFinite(observed.minus(forecast), "errorPp"),
        "errorPp",
      ),
    };
  } catch {
    return { status: "unavailable", reason: "invalid_value" };
  }
}
