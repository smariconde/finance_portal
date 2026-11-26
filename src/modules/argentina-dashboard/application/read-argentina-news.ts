import type { ArgentinaIndicatorRepository } from "@/modules/macro-series/application/argentina-indicator-repository";
import type { MacroSeriesRepository } from "@/modules/macro-series/application/macro-series-repository";
import { readMacroSeries } from "@/modules/macro-series/application/read-macro-series";
import type { RemForecastRepository } from "@/modules/macro-series/application/rem-forecast-repository";
import {
  readIndicatorVintages,
  seasonallyAdjustedMonthlyChange,
  type ArgentinaIndicatorVintage,
} from "@/modules/macro-series/domain/argentina-indicator";
import { bcraSeriesKey } from "@/modules/macro-series/domain/bcra-monetary-source";
import { declaredArgentinaIndicator } from "@/modules/macro-series/domain/declared-argentina-indicators";
import type { RemForecastVintage } from "@/modules/macro-series/domain/plan-rem-release";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { shiftMonth } from "../domain/chart-history";

import {
  argentinaNews,
  latestJointReading,
  latestReading,
  type ArgentinaNews,
  type NewsMetric,
  type NewsReading,
} from "../domain/argentina-news";
import { DASHBOARD_BCRA_VARIABLES } from "./load-argentina-dashboard";

/** The indicators the news reads, one per metric (trade reads two). */
const NEWS_INDICATORS = {
  activity: "emae_sa",
  primaryBalance: "fiscal_primary_result",
  exports: "exports_goods",
  imports: "imports_goods",
} as const;

function remReading(round: readonly RemForecastVintage[]): NewsReading | null {
  if (round.length === 0) return null;
  const sorted = [...round].sort((a, b) =>
    a.targetMonth.localeCompare(b.targetMonth),
  );
  return {
    on: sorted[0]!.roundMonth,
    values: sorted.map((forecast) => forecast.medianPercent),
    // A round is seven medians: no single figure stands for it.
    headline: null,
  };
}

/**
 * The EMAE's latest month, with the figure its tile shows: the seasonally
 * adjusted change against the month before, `null` when that month is
 * missing. The level still decides what is new or revised.
 */
function activityReading(
  vintages: readonly ArgentinaIndicatorVintage[],
): NewsReading | null {
  const reading = latestReading(
    vintages.map((point) => ({ on: point.periodOn, value: point.value })),
  );
  if (reading === null) return null;
  const declared = declaredArgentinaIndicator(NEWS_INDICATORS.activity)!;
  const current = vintages.find((point) => point.periodOn === reading.on);
  const previous = vintages.find(
    (point) => point.periodOn === shiftMonth(reading.on, -1),
  );
  const change = seasonallyAdjustedMonthlyChange({
    indicator: declared,
    previous: previous ?? null,
    current: current ?? null,
  });
  return {
    ...reading,
    headline: change.status === "computed" ? change.value : null,
  };
}

/**
 * What arrived since `since` (`argentina-news-1.0.0`, ADR 0079): each metric
 * read as this installation had recorded it now and at `since`. One indicator
 * query serves both cutoffs; the CPI and the REM round are read twice, each a
 * small read. Without a baseline it opens no query at all.
 */
export async function readArgentinaNews(dependencies: {
  readonly since: string | null;
  /** The dashboard's own cutoff, so both read the same instant. */
  readonly now: string;
  readonly indicators: ArgentinaIndicatorRepository;
  readonly macro: MacroSeriesRepository;
  readonly remForecasts: RemForecastRepository;
}): Promise<ArgentinaNews> {
  const { since, now } = dependencies;
  if (since === null) return { status: "no_baseline" };

  const stored = await dependencies.indicators.allObservationsOf(
    Object.values(NEWS_INDICATORS),
  );

  async function readingsAt(
    knownAt: string,
  ): Promise<Record<NewsMetric, NewsReading | null>> {
    function vintages(id: string) {
      const declared = declaredArgentinaIndicator(id);
      if (declared === null) throw new Error(`indicator_not_declared: ${id}`);
      return readIndicatorVintages(declared, stored.get(id) ?? [], {
        effectiveOn: knownAt.slice(0, 10),
        knownAt,
        knowledgeBasis: "system_recorded",
      }).filter((point) => point.missingReason !== "withdrawn");
    }

    function points(id: string) {
      return vintages(id).map((point) => ({
        on: point.periodOn,
        value: point.value,
      }));
    }

    const [inflation, round] = await Promise.all([
      readMacroSeries(
        bcraSeriesKey(DASHBOARD_BCRA_VARIABLES.monthlyInflation),
        pointInTimeQuerySchema.parse({
          effectiveAt: knownAt,
          knownAt,
          revisionPolicy: "as_known",
          knowledgeBasis: "system_recorded",
          sourcePolicyVersion: "source-policy-1.0.0",
        }),
        dependencies.macro,
      ),
      dependencies.remForecasts.latestRoundAsKnown({
        knownAt,
        knowledgeBasis: "system_recorded",
      }),
    ]);

    return {
      activity: activityReading(vintages(NEWS_INDICATORS.activity)),
      inflation:
        inflation.status === "read"
          ? latestReading(
              inflation.points.map((point) => ({
                on: point.periodOn,
                value: point.value,
              })),
            )
          : null,
      remRound: remReading(round),
      primaryBalance: latestReading(points(NEWS_INDICATORS.primaryBalance)),
      tradeBalance: latestJointReading(
        points(NEWS_INDICATORS.exports),
        points(NEWS_INDICATORS.imports),
      ),
    };
  }

  const [current, baseline] = await Promise.all([
    readingsAt(now),
    readingsAt(since),
  ]);
  return argentinaNews({ since, current, baseline });
}
