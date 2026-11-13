import type { ArgentinaIndicatorRepository } from "./argentina-indicator-repository";
import type { RemForecastRepository } from "./rem-forecast-repository";
import { readIndicatorVintages } from "../domain/argentina-indicator";
import { declaredIndecExpandedIndicator } from "../domain/declared-indec-expanded-indicators";
import {
  ipcMonthlyInflation,
  type IpcMonthlyInflation,
} from "../domain/ipc-monthly-inflation";
import {
  remInflationError,
  type RemInflationError,
} from "../domain/rem-inflation-error";
import type { RemForecastVintage } from "../domain/plan-rem-release";

export type RemInflationComparisonRow = {
  readonly forecast: RemForecastVintage;
  readonly actual: IpcMonthlyInflation;
  readonly error: RemInflationError;
};

/** One latest REM round, matched only to national INDEC index months known at the cutoff. */
export async function readRemInflationComparison(input: {
  readonly knownAt: string;
  readonly knowledgeBasis: "public_availability" | "system_recorded";
  readonly forecasts: RemForecastRepository;
  readonly indicators: ArgentinaIndicatorRepository;
}): Promise<readonly RemInflationComparisonRow[]> {
  const indicator = declaredIndecExpandedIndicator("ipc_nacional");
  if (indicator === null) throw new Error("ipc_nacional_not_declared");
  const [forecasts, stored] = await Promise.all([
    input.forecasts.latestRoundAsKnown({
      knownAt: input.knownAt,
      knowledgeBasis: input.knowledgeBasis,
    }),
    input.indicators.allObservations(indicator.id),
  ]);
  if (forecasts.length === 0) return [];
  const visible = readIndicatorVintages(indicator, stored, {
    effectiveOn: input.knownAt.slice(0, 10),
    knownAt: input.knownAt,
    knowledgeBasis: input.knowledgeBasis,
  });
  const byMonth = new Map(
    visible.map((point) => [point.periodOn.slice(0, 7), point]),
  );
  return forecasts.map((forecast) => {
    const previous = new Date(`${forecast.targetMonth}-01T00:00:00.000Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const actual = ipcMonthlyInflation({
      indicator,
      previous: byMonth.get(previous.toISOString().slice(0, 7)) ?? null,
      current: byMonth.get(forecast.targetMonth) ?? null,
    });
    const error = remInflationError({
      knownAt: input.knownAt,
      forecast: {
        targetMonth: forecast.targetMonth,
        medianPercent: forecast.medianPercent,
        availableAt: forecast.availableAt,
        unit: "percent_monthly",
      },
      actual:
        actual.status === "computed"
          ? {
              targetMonth: actual.targetMonth,
              monthlyPercent: actual.monthlyPercent,
              availableAt: actual.availableAt,
              unit: "percent_monthly",
            }
          : null,
    });
    return { forecast, actual, error };
  });
}
