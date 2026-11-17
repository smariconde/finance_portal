import type { ArgentinaIndicatorVintage } from "@/modules/macro-series/domain/argentina-indicator";
import {
  countryRiskIndexOn,
  type CountryRiskIndexSegment,
} from "@/modules/macro-series/domain/declared-country-risk";
import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import { monthEndCloses } from "./chart-history";

/**
 * The country risk block of `/argentina` (`country-risk-block-1.0.0`, ADR
 * 0080): the latest close with the index it belongs to, its change in basis
 * points against the previous published close, and the series for the chart
 * —day by day for five years, every month's close for the whole history—.
 * It describes; it never explains a move.
 */
export const COUNTRY_RISK_BLOCK_VERSION = "country-risk-block-1.0.0";

export type CountryRiskClose = {
  readonly on: string;
  readonly value: string;
};

export type CountryRiskBlock = {
  readonly days: readonly {
    readonly on: string;
    readonly value: string | null;
  }[];
  readonly months: readonly {
    readonly on: string;
    readonly value: string | null;
  }[];
  readonly latest:
    | (CountryRiskClose & {
        readonly observedAt: string;
        readonly revision: number;
        readonly index: CountryRiskIndexSegment | null;
      })
    | null;
  /** The previous published close, and the change against it in basis points. */
  readonly previous: CountryRiskClose | null;
  readonly changeBp: string | null;
};

const decimal = createDecimalOperations((code) => new Error(code));

export function buildCountryRiskBlock(input: {
  /** Visible vintages at the cutoff, ordered by day. */
  readonly points: readonly ArgentinaIndicatorVintage[];
  readonly dailyFromOn: string;
}): CountryRiskBlock {
  const values = input.points.map((point) => ({
    on: point.periodOn,
    value: point.value,
  }));
  const published = input.points.filter(
    (point): point is ArgentinaIndicatorVintage & { value: string } =>
      point.value !== null,
  );
  const last = published.at(-1) ?? null;
  const before = published.at(-2) ?? null;
  return {
    days: values.filter((point) => point.on >= input.dailyFromOn),
    months: monthEndCloses(values).map((month) => ({
      on: month.on,
      value: month.value,
    })),
    latest:
      last === null
        ? null
        : {
            on: last.periodOn,
            value: last.value,
            observedAt: last.availableAt,
            revision: last.revision,
            index: countryRiskIndexOn(last.periodOn),
          },
    previous:
      before === null ? null : { on: before.periodOn, value: before.value },
    changeBp:
      last === null || before === null
        ? null
        : decimal.formatDecimal(
            decimal
              .parseDecimal(last.value, "country_risk.latest")
              .minus(
                decimal.parseDecimal(before.value, "country_risk.previous"),
              ),
            "country_risk.change",
          ),
  };
}
