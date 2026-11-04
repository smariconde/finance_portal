import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import { cbotSoyFrontContract } from "@/modules/soy-basis/domain/cbot-soy-contract";
import {
  calculateSoyBasis,
  type SoyBasisResult,
} from "@/modules/soy-basis/domain/soy-basis";

import {
  monthEndCloses,
  pointChange,
  type MonthEndValue,
  type PointChange,
} from "./chart-history";
import { dailyWindowStart, type IndicatorSeries } from "./argentina-dashboard";

/**
 * The soy block of `/argentina` (`F9-05`, ADR 0071). The basis exists only on
 * a board day: each one is read with `soy-basis-1.0.0` against the BNA quote
 * and the CBOT front month **of that same day**, never the day before, and a
 * day where a leg is missing says which. Chicago's contract comes from
 * `cbot-soy-front-contract-1.0.0` and its delivery period is marked, never
 * dropped (owner's decision).
 */
export type SoyUnavailableReason = Extract<
  SoyBasisResult,
  { status: "unavailable" }
>["reason"];

export type SoyDay = {
  readonly on: string;
  /** The board, pesos per tonne; `null` on a day without a quote («S/C»). */
  readonly rosarioArs: string | null;
  readonly fx: string | null;
  readonly rosarioUsd: string | null;
  /** Chicago as Yahoo quotes it: US cents per bushel. */
  readonly chicagoCents: string | null;
  readonly chicagoUsd: string | null;
  readonly contract: string;
  readonly inDeliveryPeriod: boolean;
  /** `(Rosario ÷ Chicago − 1) × 100`, in percent. */
  readonly basis: string | null;
  readonly reason: SoyUnavailableReason | null;
};

export type SoyMonth = {
  readonly on: string;
  readonly basis: MonthEndValue;
  readonly rosarioUsd: MonthEndValue;
  readonly chicagoUsd: MonthEndValue;
};

export type SoyCampaign = {
  /** `2025/26`. */
  readonly campaign: string;
  readonly on: string;
  readonly sownHa: string | null;
  readonly harvestedHa: string | null;
  readonly productionT: string | null;
  readonly yieldKgHa: string | null;
};

export type SoyLatest = SoyDay & {
  readonly basis: string;
  readonly firstNoticeOn: string;
  readonly lastTradeOn: string;
};

export type SoyBlock = {
  /** The last five years, one row per board day. */
  readonly days: readonly SoyDay[];
  /** The whole history at each series' month close. */
  readonly months: readonly SoyMonth[];
  /** The latest board day with all three legs: the headline reading. */
  readonly latest: SoyLatest | null;
  /** Each leg's own last published point, which may be later than `latest`. */
  readonly legs: {
    readonly rosario: { readonly on: string; readonly value: string } | null;
    readonly fx: { readonly on: string; readonly value: string } | null;
    readonly chicago: { readonly on: string; readonly value: string } | null;
  };
  readonly campaigns: readonly SoyCampaign[];
  /** Production of the latest campaign against the one before. */
  readonly productionChange: {
    readonly campaign: string;
    readonly previous: string;
    readonly change: PointChange;
  } | null;
};

function lastPublished(points: readonly ArgentinaIndicatorVintage[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (point.value !== null) return { on: point.periodOn, value: point.value };
  }
  return null;
}

function campaignOf(periodOn: string): string {
  const year = Number(periodOn.slice(0, 4));
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

export function buildSoyBlock(input: {
  readonly rosario: IndicatorSeries;
  readonly fx: IndicatorSeries;
  readonly chicago: IndicatorSeries;
  readonly sown: IndicatorSeries;
  readonly harvested: IndicatorSeries;
  readonly production: IndicatorSeries;
  readonly yieldKgHa: IndicatorSeries;
  /** The cutoff the page reads at. */
  readonly knownAt: string;
}): SoyBlock {
  const fx = new Map(input.fx.points.map((point) => [point.periodOn, point]));
  const chicago = new Map(
    input.chicago.points.map((point) => [point.periodOn, point]),
  );

  let latest: SoyLatest | null = null;
  const allDays = input.rosario.points.map((board): SoyDay => {
    const on = board.periodOn;
    const quote = fx.get(on) ?? null;
    const future = chicago.get(on) ?? null;
    const contract = cbotSoyFrontContract(on);
    const result = calculateSoyBasis({
      marketOn: on,
      knownAt: input.knownAt,
      rosario:
        board.value === null
          ? null
          : {
              marketOn: on,
              availableAt: board.availableAt,
              sourceId: input.rosario.indicator.sourceId,
              value: board.value,
              unit: "ARS/t",
              delivery: "spot_rosario",
            },
      fx:
        quote?.value == null
          ? null
          : {
              marketOn: on,
              availableAt: quote.availableAt,
              sourceId: input.fx.indicator.sourceId,
              value: quote.value,
              unit: "ARS/USD",
              side: "buyer",
              market: "BNA_divisas",
            },
      chicago:
        future?.value == null
          ? null
          : {
              marketOn: on,
              availableAt: future.availableAt,
              sourceId: input.chicago.indicator.sourceId,
              value: future.value,
              unit: "US_cents/bushel",
              contract: contract.contract,
              seriesKind: "continuous",
              rollPolicy: contract.version,
            },
    });
    const day: SoyDay = {
      on,
      rosarioArs: board.value,
      fx: quote?.value ?? null,
      rosarioUsd: result.status === "computed" ? result.rosarioUsdPerTon : null,
      chicagoCents: future?.value ?? null,
      chicagoUsd: result.status === "computed" ? result.chicagoUsdPerTon : null,
      contract: contract.contract,
      inDeliveryPeriod: contract.inDeliveryPeriod,
      basis: result.status === "computed" ? result.basisPct : null,
      reason: result.status === "computed" ? null : result.reason,
    };
    if (result.status === "computed") {
      latest = {
        ...day,
        basis: result.basisPct,
        firstNoticeOn: contract.firstNoticeOn,
        lastTradeOn: contract.lastTradeOn,
      };
    }
    return day;
  });

  const lastOn = allDays.at(-1)?.on;
  const fromOn = lastOn === undefined ? null : dailyWindowStart(lastOn);
  const days = fromOn === null ? [] : allDays.filter((day) => day.on >= fromOn);

  const closes = (pick: (day: SoyDay) => string | null) =>
    new Map(
      monthEndCloses(
        allDays.map((day) => ({ on: day.on, value: pick(day) })),
      ).map((close) => [close.on, close]),
    );
  const basisMonths = closes((day) => day.basis);
  const rosarioMonths = closes((day) => day.rosarioUsd);
  const chicagoMonths = closes((day) => day.chicagoUsd);
  const empty = (on: string): MonthEndValue => ({
    on,
    closeOn: null,
    value: null,
  });
  const months = [...basisMonths.keys()].map((on): SoyMonth => ({
    on,
    basis: basisMonths.get(on)!,
    rosarioUsd: rosarioMonths.get(on) ?? empty(on),
    chicagoUsd: chicagoMonths.get(on) ?? empty(on),
  }));

  const byCampaign = (series: IndicatorSeries) =>
    new Map(series.points.map((point) => [point.periodOn, point.value]));
  const sown = byCampaign(input.sown);
  const harvested = byCampaign(input.harvested);
  const production = byCampaign(input.production);
  const yields = byCampaign(input.yieldKgHa);
  const campaignDates = [
    ...new Set([
      ...sown.keys(),
      ...harvested.keys(),
      ...production.keys(),
      ...yields.keys(),
    ]),
  ].sort();
  const campaigns = campaignDates.map((on): SoyCampaign => ({
    campaign: campaignOf(on),
    on,
    sownHa: sown.get(on) ?? null,
    harvestedHa: harvested.get(on) ?? null,
    productionT: production.get(on) ?? null,
    yieldKgHa: yields.get(on) ?? null,
  }));
  const [previous, current] = campaigns.slice(-2);

  return {
    days,
    months,
    latest,
    legs: {
      rosario: lastPublished(input.rosario.points),
      fx: lastPublished(input.fx.points),
      chicago: lastPublished(input.chicago.points),
    },
    campaigns,
    productionChange:
      previous && current
        ? {
            campaign: current.campaign,
            previous: previous.campaign,
            change: pointChange(
              previous.productionT,
              current.productionT,
              "ratio",
            ),
          }
        : null,
  };
}
