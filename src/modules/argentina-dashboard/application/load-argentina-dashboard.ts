import type { AdrPairRepository } from "@/modules/implied-fx/application/adr-pair-repository";
import { readImpliedCcl } from "@/modules/implied-fx/application/read-implied-ccl";
import type { ArgentinaIndicatorRepository } from "@/modules/macro-series/application/argentina-indicator-repository";
import type { MacroSeriesRepository } from "@/modules/macro-series/application/macro-series-repository";
import { readMacroSeries } from "@/modules/macro-series/application/read-macro-series";
import { readTransformedMacroSeries } from "@/modules/macro-series/application/read-transformed-macro-series";
import { readIndicatorVintages } from "@/modules/macro-series/domain/argentina-indicator";
import {
  bcraSeriesKey,
  type BcraVariableId,
} from "@/modules/macro-series/domain/bcra-monetary-source";
import {
  DECLARED_ARGENTINA_INDICATORS,
  DECLARED_ITCRM,
  declaredArgentinaIndicator,
} from "@/modules/macro-series/domain/declared-argentina-indicators";
import { monthEndCloses } from "../domain/chart-history";
import {
  DECLARED_SOY_INDICATORS,
  declaredSoyIndicator,
} from "@/modules/macro-series/domain/declared-soy-indicators";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import {
  ARGENTINA_DASHBOARD_VERSION,
  buildActivityBlock,
  buildDollarBlock,
  buildExternalBlock,
  buildFiscalBlock,
  buildMonetaryBlock,
  type ActivityBlock,
  type DollarBlock,
  type ExternalBlock,
  type FiscalBlock,
  type IndicatorSeries,
  type MonetaryBlock,
} from "../domain/argentina-dashboard";
import { buildSoyBlock, type SoyBlock } from "../domain/soy-block";

/** The BCRA variables the page reads (`declared-bcra-series.ts`). */
export const DASHBOARD_BCRA_VARIABLES = {
  reserves: 1,
  wholesaleUsd: 5,
  baseMoney: 15,
  monthlyInflation: 27,
  annualInflation: 28,
  bandLow: 1187,
  bandHigh: 1188,
} as const satisfies Record<string, BcraVariableId>;

export type ArgentinaDashboard = {
  readonly version: typeof ARGENTINA_DASHBOARD_VERSION;
  /** The one cutoff every block was read at. */
  readonly readAt: string;
  readonly activity: ActivityBlock;
  readonly dollar: DollarBlock;
  readonly monetary: MonetaryBlock;
  readonly fiscal: FiscalBlock;
  readonly external: ExternalBlock;
  readonly soy: SoyBlock;
  readonly itcrm: {
    readonly days: readonly {
      readonly on: string;
      readonly value: string | null;
    }[];
    readonly months: readonly {
      readonly on: string;
      readonly value: string | null;
    }[];
    readonly latest: {
      readonly on: string;
      readonly value: string;
      readonly observedAt: string;
      readonly revision: number;
    } | null;
  };
};

/**
 * Reads every block of `/argentina` at one cutoff: what was known now, as it
 * was published. It never downloads: the page shows what the hand-run
 * commands stored, with each series' own last date.
 */
export async function loadArgentinaDashboard(dependencies: {
  readonly indicators: ArgentinaIndicatorRepository;
  readonly macro: MacroSeriesRepository;
  readonly adrPairs: AdrPairRepository;
  readonly now: () => string;
}): Promise<ArgentinaDashboard> {
  const readAt = dependencies.now();
  const today = readAt.slice(0, 10);
  const fiveYearsAgo = new Date(
    Date.parse(`${today}T00:00:00Z`) - 1_827 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: readAt,
    knownAt: readAt,
    revisionPolicy: "as_known",
    knowledgeBasis: "public_availability",
    sourcePolicyVersion: "source-policy-1.0.0",
  });

  // One read for every declared indicator: two queries instead of two each.
  // The soy set is its own declaration (ADR 0071) but the same read.
  const stored = await dependencies.indicators.allObservationsOf([
    ...DECLARED_ARGENTINA_INDICATORS.map((item) => item.id),
    ...DECLARED_SOY_INDICATORS.map((item) => item.id),
  ]);
  const itcrmStored = await dependencies.indicators.chartObservations({
    indicatorId: DECLARED_ITCRM.id,
    effectiveOn: today,
    knownAt: readAt,
    dailyFromOn: fiveYearsAgo,
  });

  function indicator(id: string): IndicatorSeries {
    const declared = declaredArgentinaIndicator(id) ?? declaredSoyIndicator(id);
    if (declared === null) throw new Error(`indicator_not_declared: ${id}`);
    const points = readIndicatorVintages(
      declared,
      id === DECLARED_ITCRM.id ? itcrmStored : (stored.get(id) ?? []),
      {
        effectiveOn: today,
        knownAt: readAt,
        knowledgeBasis: "public_availability",
      },
    ).filter((point) => point.missingReason !== "withdrawn");
    return { indicator: declared, points };
  }

  async function bcra(variableId: BcraVariableId) {
    const reading = await readMacroSeries(
      bcraSeriesKey(variableId),
      query,
      dependencies.macro,
    );
    return reading.status === "read"
      ? reading.points.map((point) => ({
          periodOn: point.periodOn,
          value: point.value,
        }))
      : [];
  }

  const sectorIds = DECLARED_ARGENTINA_INDICATORS.filter((item) =>
    item.id.startsWith("emae_sector_"),
  ).map((item) => item.id);

  const seasonallyAdjusted = indicator("emae_sa");
  const trend = indicator("emae_trend");
  const original = indicator("emae_original");
  const sectors = sectorIds.map(indicator);
  const primary = indicator("fiscal_primary_result");
  const interest = indicator("fiscal_net_interest");
  const gdp = indicator("gdp_nominal_annual");
  const exports = indicator("exports_goods");
  const imports = indicator("imports_goods");
  const itcrm = indicator(DECLARED_ITCRM.id).points;
  const itcrmValues = itcrm.map((point) => ({
    on: point.periodOn,
    value: point.value,
  }));
  const lastItcrm = [...itcrm].reverse().find((point) => point.value !== null);

  const [
    official,
    bandLow,
    bandHigh,
    ccl,
    monthlyInflation,
    annualInflation,
    reserves,
    realBase,
  ] = await Promise.all([
    bcra(DASHBOARD_BCRA_VARIABLES.wholesaleUsd),
    bcra(DASHBOARD_BCRA_VARIABLES.bandLow),
    bcra(DASHBOARD_BCRA_VARIABLES.bandHigh),
    // The whole history: the long ranges and the comparison per presidency
    // read every month's close (`F9-13`). Twenty legs since 2000 are about
    // 130,000 rows, below the read's ceiling of 200,000.
    readImpliedCcl(query, dependencies.adrPairs),
    bcra(DASHBOARD_BCRA_VARIABLES.monthlyInflation),
    bcra(DASHBOARD_BCRA_VARIABLES.annualInflation),
    bcra(DASHBOARD_BCRA_VARIABLES.reserves),
    readTransformedMacroSeries(
      { variableId: DASHBOARD_BCRA_VARIABLES.baseMoney, kind: "real_cpi" },
      query,
      dependencies.macro,
    ),
  ]);

  const realBaseComputed =
    realBase.status === "read" && realBase.transformation.status === "computed"
      ? realBase.transformation
      : null;

  return {
    version: ARGENTINA_DASHBOARD_VERSION,
    readAt,
    activity: buildActivityBlock({
      seasonallyAdjusted,
      trend,
      original,
      sectors,
    }),
    dollar: buildDollarBlock({ official, ccl, bandLow, bandHigh }),
    monetary: buildMonetaryBlock({
      monthlyInflation,
      annualInflation,
      reserves,
      realBase: realBaseComputed?.points ?? [],
      realBaseUnit: realBaseComputed?.unit ?? null,
      realBaseOn: realBaseComputed?.baseOn ?? null,
    }),
    fiscal: buildFiscalBlock({ primary, interest, gdp }),
    external: buildExternalBlock({ exports, imports }),
    soy: buildSoyBlock({
      rosario: indicator("soy_rosario_pizarra"),
      fx: indicator("usd_bna_divisas_buyer"),
      chicago: indicator("soy_cbot_front"),
      sown: indicator("soy_area_sown"),
      harvested: indicator("soy_area_harvested"),
      production: indicator("soy_production"),
      yieldKgHa: indicator("soy_yield"),
      ccl,
      knownAt: readAt,
    }),
    itcrm: {
      days: itcrmValues.filter((point) => point.on >= fiveYearsAgo),
      months: monthEndCloses(itcrmValues),
      latest: lastItcrm?.value
        ? {
            on: lastItcrm.periodOn,
            value: lastItcrm.value,
            observedAt: lastItcrm.availableAt,
            revision: lastItcrm.revision,
          }
        : null,
    },
  };
}
