import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import type { ArgentinaIndicatorRepository } from "./argentina-indicator-repository";
import type { MacroSeriesRepository } from "./macro-series-repository";
import { readMacroSeries } from "./read-macro-series";
import type { RemForecastRepository } from "./rem-forecast-repository";
import { bcraSeriesKey } from "../domain/bcra-monetary-source";
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

/**
 * The observed CPI of a month when the INDEC API does not carry it yet
 * (`rem-observed-ipc-1.0.0`, `F9-24`, owner's decision of 2026-11-26): the
 * monthly inflation the BCRA republishes (variable 27, one decimal), named
 * as such in its row. The INDEC index wins as soon as it has the month.
 */
export const REM_OBSERVED_IPC_VERSION = "rem-observed-ipc-1.0.0";

/** BCRA Principales Variables: monthly inflation (INDEC CPI, % monthly). */
export const BCRA_MONTHLY_INFLATION_VARIABLE = 27;

export type RemObservedInflation =
  | (Extract<IpcMonthlyInflation, { status: "computed" }> & {
      readonly source: "indec_index";
    })
  | {
      readonly status: "computed";
      readonly source: "bcra_monthly";
      readonly targetMonth: string;
      readonly monthlyPercent: string;
      readonly availableAt: string;
      readonly version: typeof REM_OBSERVED_IPC_VERSION;
    }
  | Extract<IpcMonthlyInflation, { status: "unavailable" }>;

export type RemInflationComparisonRow = {
  readonly forecast: RemForecastVintage;
  readonly actual: RemObservedInflation;
  readonly error: RemInflationError;
};

type BcraMonthly = { readonly value: string; readonly availableAt: string };

/** Variable 27 by month, as known at the cutoff; empty when unreadable. */
async function bcraMonthlyInflation(
  macro: MacroSeriesRepository,
  knownAt: string,
  knowledgeBasis: "public_availability" | "system_recorded",
): Promise<ReadonlyMap<string, BcraMonthly>> {
  const reading = await readMacroSeries(
    bcraSeriesKey(BCRA_MONTHLY_INFLATION_VARIABLE),
    pointInTimeQuerySchema.parse({
      effectiveAt: knownAt,
      knownAt,
      revisionPolicy: "as_known",
      knowledgeBasis,
      sourcePolicyVersion: "source-policy-1.0.0",
    }),
    macro,
  );
  if (reading.status !== "read") return new Map();
  return new Map(
    reading.points.map((point) => [
      point.periodOn.slice(0, 7),
      { value: point.value, availableAt: point.availableAt },
    ]),
  );
}

/**
 * One latest REM round, matched to the national INDEC index months known at
 * the cutoff and, for a month the INDEC API lacks, to the BCRA's
 * republication of the same CPI (`rem-observed-ipc-1.0.0`).
 */
export async function readRemInflationComparison(input: {
  readonly knownAt: string;
  readonly knowledgeBasis: "public_availability" | "system_recorded";
  readonly forecasts: RemForecastRepository;
  readonly indicators: ArgentinaIndicatorRepository;
  /** Without it, only the INDEC index is read. */
  readonly macro?: MacroSeriesRepository;
}): Promise<readonly RemInflationComparisonRow[]> {
  const indicator = declaredIndecExpandedIndicator("ipc_nacional");
  if (indicator === null) throw new Error("ipc_nacional_not_declared");
  const [forecasts, stored, bcra] = await Promise.all([
    input.forecasts.latestRoundAsKnown({
      knownAt: input.knownAt,
      knowledgeBasis: input.knowledgeBasis,
    }),
    input.indicators.allObservations(indicator.id),
    input.macro === undefined
      ? Promise.resolve(new Map<string, BcraMonthly>())
      : bcraMonthlyInflation(input.macro, input.knownAt, input.knowledgeBasis),
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
    const indec = ipcMonthlyInflation({
      indicator,
      previous: byMonth.get(previous.toISOString().slice(0, 7)) ?? null,
      current: byMonth.get(forecast.targetMonth) ?? null,
    });
    const fallback = bcra.get(forecast.targetMonth);
    const actual: RemObservedInflation =
      indec.status === "computed"
        ? { ...indec, source: "indec_index" }
        : fallback !== undefined
          ? {
              status: "computed",
              source: "bcra_monthly",
              targetMonth: forecast.targetMonth,
              monthlyPercent: fallback.value,
              availableAt: fallback.availableAt,
              version: REM_OBSERVED_IPC_VERSION,
            }
          : indec;
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
