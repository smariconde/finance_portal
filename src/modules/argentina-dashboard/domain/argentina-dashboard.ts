import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";
import {
  fiscalShareOfGdp,
  seasonallyAdjustedMonthlyChange,
  tradeBalance,
  yearOverYearChange,
  type ArgentinaIndicator,
  type ArgentinaIndicatorVintage,
  type Comparison,
} from "@/modules/macro-series/domain/argentina-indicator";

import {
  monthEndCloses,
  shiftMonth,
  type DatedValue,
  type MonthEndValue,
} from "./chart-history";
import {
  compareGovernments,
  type GovernmentPath,
} from "./government-comparison";

export type { DatedValue } from "./chart-history";

/**
 * How the Argentina page reads what is stored (`F9-06`): latest points and
 * the readings each block shows. It never fills a gap: a missing point is a
 * `null` with its reason, and a block without data says so.
 *
 * Since `2.0.0` (`F9-13`) every monthly series goes out whole, a daily series
 * goes out day by day for its last five years and at each month's close for
 * its whole history (`month-end-close-1.0.0`), and each block carries its
 * path per presidency (`government-comparison-1.0.0`). Which range opens
 * first is the chart's choice, not the read's.
 */
export const ARGENTINA_DASHBOARD_VERSION = "argentina-dashboard-2.0.0";

export const SECTOR_WINDOW_MONTHS = 12;
/** Calendar days a daily series goes out day by day: five years. */
export const DAILY_WINDOW_DAYS = 1_827;
export const FIRST_FISCAL_YEAR = 2016;

const decimal = createDecimalOperations((code) => new Error(code));

export type IndicatorSeries = {
  readonly indicator: ArgentinaIndicator;
  readonly points: readonly ArgentinaIndicatorVintage[];
};

export type DatedComparison = {
  readonly on: string;
  readonly change: Comparison;
};

export type ActivityBlock = {
  readonly seasonallyAdjusted: readonly DatedValue[];
  readonly trend: readonly DatedValue[];
  readonly latest: {
    readonly on: string;
    readonly level: string | null;
    readonly monthOverMonth: Comparison;
    readonly yearOverYear: Comparison;
  } | null;
  readonly sectorMonths: readonly string[];
  readonly sectors: readonly {
    readonly id: string;
    readonly code: string;
    readonly label: string;
    readonly cells: readonly DatedComparison[];
  }[];
  /** The seasonally adjusted EMAE per presidency, `100` the month before. */
  readonly governments: readonly GovernmentPath[];
};

export type DollarDay = {
  readonly on: string;
  readonly official: string | null;
  readonly ccl: string | null;
  /** `CCL / oficial − 1` as a fraction, only on days both published. */
  readonly gap: string | null;
  readonly bandLow: string | null;
  readonly bandHigh: string | null;
};

/** A month read at each series' own close (`month-end-close-1.0.0`). */
export type DollarMonth = {
  readonly on: string;
  readonly official: string | null;
  readonly ccl: string | null;
  /** The gap of the month's last day on which both quotes published. */
  readonly gap: string | null;
  readonly bandLow: string | null;
  readonly bandHigh: string | null;
};

export type DollarBlock = {
  /** The last five years, day by day. */
  readonly days: readonly DollarDay[];
  /** The whole history, one row per month. */
  readonly months: readonly DollarMonth[];
  readonly governments: {
    /** Each presidency, `100` the last close before taking office. */
    readonly official: readonly GovernmentPath[];
    readonly ccl: readonly GovernmentPath[];
  };
  readonly latestOfficial: DatedValue | null;
  readonly latestCcl: DatedValue | null;
  /** The latest day with both quotes, which may precede either latest. */
  readonly latestGap: { readonly on: string; readonly gap: string } | null;
  readonly latestBand: {
    readonly on: string;
    readonly low: string;
    readonly high: string;
  } | null;
};

export type MonetaryBlock = {
  readonly monthlyInflation: readonly DatedValue[];
  /** Year-over-year inflation as the BCRA publishes it, every month. */
  readonly annualInflationSeries: readonly DatedValue[];
  readonly annualInflation: DatedValue | null;
  /** The last five years, day by day. */
  readonly reserves: readonly DatedValue[];
  /** The whole history at each month's close. */
  readonly reserveMonths: readonly MonthEndValue[];
  readonly realBase: readonly DatedValue[];
  readonly realBaseUnit: string | null;
  /** The month whose pesos are the unit of the real base. */
  readonly realBaseOn: string | null;
  readonly governments: {
    /** Prices chained from the month before taking office, `100` there. */
    readonly prices: readonly GovernmentPath[];
    /** Reserves gained or lost since the last day before taking office. */
    readonly reserves: readonly GovernmentPath[];
  };
};

export type FiscalYear = {
  readonly year: number;
  readonly primary: Comparison;
  readonly interest: Comparison;
};

export type FiscalBlock = {
  readonly years: readonly FiscalYear[];
  /** The running year: months recorded and the primary result in pesos. */
  readonly yearToDate: {
    readonly year: number;
    readonly months: number;
    readonly lastOn: string;
    readonly primary: string;
  } | null;
};

export type TradeMonth = {
  readonly on: string;
  readonly exports: string | null;
  readonly imports: string | null;
  readonly balance: Comparison;
};

export type ExternalBlock = {
  readonly months: readonly TradeMonth[];
  /** The trade balance added month by month from the inauguration month. */
  readonly governments: readonly GovernmentPath[];
  /** Sums of the last twelve months, only when all twelve are present. */
  readonly lastTwelve: {
    readonly fromOn: string;
    readonly toOn: string;
    readonly exports: string;
    readonly imports: string;
    readonly balance: string;
  } | null;
};

function toDated(points: readonly ArgentinaIndicatorVintage[]): DatedValue[] {
  return points.map((point) => ({ on: point.periodOn, value: point.value }));
}

/** First calendar day of a daily window ending on `lastOn`. */
export function dailyWindowStart(
  lastOn: string,
  days = DAILY_WINDOW_DAYS,
): string {
  const date = new Date(`${lastOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function byPeriod(points: readonly ArgentinaIndicatorVintage[]) {
  return new Map(points.map((point) => [point.periodOn, point]));
}

export function buildActivityBlock(input: {
  readonly seasonallyAdjusted: IndicatorSeries;
  readonly trend: IndicatorSeries;
  readonly original: IndicatorSeries;
  readonly sectors: readonly IndicatorSeries[];
}): ActivityBlock {
  const sa = input.seasonallyAdjusted.points;
  const last = sa.at(-1) ?? null;
  const previous = last
    ? (byPeriod(sa).get(shiftMonth(last.periodOn, -1)) ?? null)
    : null;
  const original = byPeriod(input.original.points);
  const latest =
    last === null
      ? null
      : {
          on: last.periodOn,
          level: last.value,
          monthOverMonth: seasonallyAdjustedMonthlyChange({
            indicator: input.seasonallyAdjusted.indicator,
            previous,
            current: last,
          }),
          yearOverYear: yearOverYearChange({
            indicator: input.original.indicator,
            yearEarlier: original.get(shiftMonth(last.periodOn, -12)) ?? null,
            current: original.get(last.periodOn) ?? null,
          }),
        };

  const sectorLast = input.sectors
    .map((sector) => sector.points.at(-1)?.periodOn ?? "")
    .sort()
    .at(-1);
  const sectorMonths =
    sectorLast === undefined || sectorLast === ""
      ? []
      : Array.from({ length: SECTOR_WINDOW_MONTHS }, (_, index) =>
          shiftMonth(sectorLast, index - SECTOR_WINDOW_MONTHS + 1),
        );

  return {
    seasonallyAdjusted: toDated(sa),
    trend: toDated(input.trend.points),
    latest,
    sectorMonths,
    sectors: input.sectors.map((sector) => {
      const points = byPeriod(sector.points);
      const code = sector.indicator.filters.codigo ?? sector.indicator.id;
      return {
        id: sector.indicator.id,
        code,
        label:
          sector.indicator.filters.descripcion ??
          sector.indicator.reportingScope,
        cells: sectorMonths.map((on) => ({
          on,
          change: yearOverYearChange({
            indicator: sector.indicator,
            yearEarlier: points.get(shiftMonth(on, -12)) ?? null,
            current: points.get(on) ?? null,
          }),
        })),
      };
    }),
    governments: compareGovernments({
      points: toDated(sa),
      frequency: "monthly",
      basis: "index",
    }),
  };
}

type DailyPoint = { readonly periodOn: string; readonly value: string };

function latestOf(points: readonly DailyPoint[]): DatedValue | null {
  const last = points.at(-1);
  return last ? { on: last.periodOn, value: last.value } : null;
}

function gapOf(official: string | null, ccl: string | null, on: string) {
  if (official === null || ccl === null) return null;
  return decimal.formatDecimal(
    decimal
      .divide(
        decimal.parseDecimal(ccl, on),
        decimal.parseDecimal(official, on),
        on,
      )
      .minus(1),
    on,
  );
}

function dated(points: readonly DailyPoint[]): DatedValue[] {
  return points.map((point) => ({ on: point.periodOn, value: point.value }));
}

export function buildDollarBlock(input: {
  readonly official: readonly DailyPoint[];
  readonly ccl: readonly {
    readonly marketDate: string;
    readonly value: string | null;
  }[];
  readonly bandLow: readonly DailyPoint[];
  readonly bandHigh: readonly DailyPoint[];
}): DollarBlock {
  const lastOn = [input.official.at(-1)?.periodOn, input.ccl.at(-1)?.marketDate]
    .filter((on): on is string => on !== undefined)
    .sort()
    .at(-1);
  if (lastOn === undefined) {
    return {
      days: [],
      months: [],
      governments: { official: [], ccl: [] },
      latestOfficial: null,
      latestCcl: null,
      latestGap: null,
      latestBand: null,
    };
  }
  const official = new Map(input.official.map((p) => [p.periodOn, p.value]));
  const ccl = new Map(input.ccl.map((p) => [p.marketDate, p.value]));
  const low = new Map(input.bandLow.map((p) => [p.periodOn, p.value]));
  const high = new Map(input.bandHigh.map((p) => [p.periodOn, p.value]));
  const dates = [...new Set([...official.keys(), ...ccl.keys()])].sort();

  const allDays = dates.map((on): DollarDay => {
    const o = official.get(on) ?? null;
    const c = ccl.get(on) ?? null;
    return {
      on,
      official: o,
      ccl: c,
      gap: gapOf(o, c, on),
      bandLow: low.get(on) ?? null,
      bandHigh: high.get(on) ?? null,
    };
  });
  const fromOn = dailyWindowStart(lastOn);
  const days = allDays.filter((day) => day.on >= fromOn);

  const cclDated = input.ccl.map((p) => ({ on: p.marketDate, value: p.value }));
  const closes = (points: readonly DatedValue[]) =>
    new Map(monthEndCloses(points).map((close) => [close.on, close.value]));
  const officialMonths = closes(dated(input.official));
  const cclMonths = closes(cclDated);
  const gapMonths = closes(
    allDays.map((day) => ({ on: day.on, value: day.gap })),
  );
  const lowMonths = closes(dated(input.bandLow));
  const highMonths = closes(dated(input.bandHigh));
  const monthKeys = [
    ...new Set([...officialMonths.keys(), ...cclMonths.keys()]),
  ].sort();
  const months = monthKeys.map((on): DollarMonth => ({
    on,
    official: officialMonths.get(on) ?? null,
    ccl: cclMonths.get(on) ?? null,
    gap: gapMonths.get(on) ?? null,
    bandLow: lowMonths.get(on) ?? null,
    bandHigh: highMonths.get(on) ?? null,
  }));

  const withGap = allDays.filter((day) => day.gap !== null).at(-1);
  const cclPoints = input.ccl.filter(
    (p): p is { marketDate: string; value: string } => p.value !== null,
  );
  const lastLow = input.bandLow.at(-1);
  const lastHigh = input.bandHigh.at(-1);

  return {
    days,
    months,
    governments: {
      official: compareGovernments({
        points: dated(input.official),
        frequency: "daily",
        basis: "index",
      }),
      ccl: compareGovernments({
        points: cclDated,
        frequency: "daily",
        basis: "index",
      }),
    },
    latestOfficial: latestOf(input.official),
    latestCcl: cclPoints.length
      ? { on: cclPoints.at(-1)!.marketDate, value: cclPoints.at(-1)!.value }
      : null,
    latestGap: withGap ? { on: withGap.on, gap: withGap.gap! } : null,
    latestBand:
      lastLow && lastHigh && lastLow.periodOn === lastHigh.periodOn
        ? { on: lastLow.periodOn, low: lastLow.value, high: lastHigh.value }
        : null,
  };
}

export function buildMonetaryBlock(input: {
  readonly monthlyInflation: readonly DailyPoint[];
  readonly annualInflation: readonly DailyPoint[];
  readonly reserves: readonly DailyPoint[];
  readonly realBase: readonly {
    readonly periodOn: string;
    readonly value: string | null;
  }[];
  readonly realBaseUnit: string | null;
  readonly realBaseOn: string | null;
}): MonetaryBlock {
  const lastReserve = input.reserves.at(-1)?.periodOn;
  const fromOn = lastReserve ? dailyWindowStart(lastReserve) : null;
  const reserves = dated(input.reserves);
  return {
    monthlyInflation: dated(input.monthlyInflation),
    annualInflationSeries: dated(input.annualInflation),
    annualInflation: latestOf(input.annualInflation),
    reserves:
      fromOn === null ? [] : reserves.filter((point) => point.on >= fromOn),
    reserveMonths: monthEndCloses(reserves),
    realBase: input.realBase.map((p) => ({ on: p.periodOn, value: p.value })),
    realBaseUnit: input.realBaseUnit,
    realBaseOn: input.realBaseOn,
    governments: {
      prices: compareGovernments({
        points: dated(input.monthlyInflation),
        frequency: "monthly",
        basis: "cumulative_rate",
      }),
      reserves: compareGovernments({
        points: reserves,
        frequency: "daily",
        basis: "difference",
      }),
    },
  };
}

export function buildFiscalBlock(input: {
  readonly primary: IndicatorSeries;
  readonly interest: IndicatorSeries;
  readonly gdp: IndicatorSeries;
}): FiscalBlock {
  const lastPrimary = input.primary.points.at(-1);
  if (!lastPrimary) return { years: [], yearToDate: null };
  const lastYear = Number(lastPrimary.periodOn.slice(0, 4));
  const ofYear = (series: IndicatorSeries, year: number) =>
    series.points.filter((p) => p.periodOn.startsWith(`${year}-`));
  const gdpOf = (year: number) =>
    input.gdp.points.find((p) => p.periodOn.startsWith(`${year}-`)) ?? null;

  const years: FiscalYear[] = [];
  for (let year = FIRST_FISCAL_YEAR; year <= lastYear; year += 1) {
    const primaryMonths = ofYear(input.primary, year);
    if (primaryMonths.length < 12) continue;
    years.push({
      year,
      primary: fiscalShareOfGdp({
        fiscal: input.primary.indicator,
        monthlyFiscal: primaryMonths,
        gdp: input.gdp.indicator,
        annualGdp: gdpOf(year),
        year,
      }),
      interest: fiscalShareOfGdp({
        fiscal: input.interest.indicator,
        monthlyFiscal: ofYear(input.interest, year),
        gdp: input.gdp.indicator,
        annualGdp: gdpOf(year),
        year,
      }),
    });
  }

  const running = ofYear(input.primary, lastYear);
  const yearToDate =
    running.length > 0 &&
    running.length < 12 &&
    running.every((point) => point.value !== null)
      ? {
          year: lastYear,
          months: running.length,
          lastOn: running.at(-1)!.periodOn,
          primary: decimal.formatDecimal(
            running.reduce(
              (total, point) =>
                total.plus(decimal.parseDecimal(point.value!, "ytd")),
              decimal.parseDecimal("0", "ytd"),
            ),
            "ytd",
          ),
        }
      : null;

  return { years, yearToDate };
}

export function buildExternalBlock(input: {
  readonly exports: IndicatorSeries;
  readonly imports: IndicatorSeries;
}): ExternalBlock {
  const imports = byPeriod(input.imports.points);
  const months = input.exports.points.map((exportPoint): TradeMonth => {
    const importPoint = imports.get(exportPoint.periodOn) ?? null;
    return {
      on: exportPoint.periodOn,
      exports: exportPoint.value,
      imports: importPoint?.value ?? null,
      balance: tradeBalance({
        exports: input.exports.indicator,
        imports: input.imports.indicator,
        exportPoint,
        importPoint,
      }),
    };
  });

  const twelve = months.slice(-12);
  const complete =
    twelve.length === 12 &&
    twelve.every((month) => month.exports !== null && month.imports !== null) &&
    twelve.at(-1)!.on === shiftMonth(twelve[0]!.on, 11);
  const sum = (pick: (month: TradeMonth) => string) =>
    twelve.reduce(
      (total, month) => total.plus(decimal.parseDecimal(pick(month), month.on)),
      decimal.parseDecimal("0", "sum"),
    );

  return {
    months,
    governments: compareGovernments({
      points: months.map((month) => ({
        on: month.on,
        value: month.balance.status === "computed" ? month.balance.value : null,
      })),
      frequency: "monthly",
      basis: "cumulative_sum",
    }),
    lastTwelve: complete
      ? {
          fromOn: twelve[0]!.on,
          toOn: twelve.at(-1)!.on,
          exports: decimal.formatDecimal(
            sum((m) => m.exports!),
            "exports",
          ),
          imports: decimal.formatDecimal(
            sum((m) => m.imports!),
            "imports",
          ),
          balance: decimal.formatDecimal(
            sum((m) => m.exports!).minus(sum((m) => m.imports!)),
            "balance",
          ),
        }
      : null,
  };
}
