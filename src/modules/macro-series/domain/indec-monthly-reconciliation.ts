import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import type { ArgentinaIndicator } from "./argentina-indicator";
import type { IndecPoint } from "./indec-api-parser";

export const INDEC_MONTHLY_RECONCILIATION_VERSION =
  "indec-monthly-reconciliation-1.0.0";

/** The API publishes rates rounded to one tenth of a percentage point. */
const MAX_DIFFERENCE_PP = "0.051";

export type IndecMonthlyReconciliation =
  | {
      readonly status: "matched";
      readonly periodOn: string;
      readonly computed: string;
      readonly published: string;
      readonly differencePp: string;
      readonly version: typeof INDEC_MONTHLY_RECONCILIATION_VERSION;
    }
  | {
      readonly status: "refused";
      readonly reason:
        | "incompatible_series"
        | "incompatible_period"
        | "missing_value"
        | "non_positive_level"
        | "invalid_value"
        | "published_mismatch";
    };

/** The second, non-persisted reading is an exact sibling of the declared level. */
export function publishedMonthlyRateIndicator(
  indicator: ArgentinaIndicator,
): ArgentinaIndicator {
  return {
    ...indicator,
    unit: "Porcentaje",
    currency: "percent",
    indexBase: null,
    filters: {
      ...indicator.filters,
      tipo_de_indicador: "v_m",
      tipo_de_indicador_descripcion:
        "Variación porcentual respecto del período anterior",
      unidad_de_medida: "Porcentaje",
    },
  };
}

function nextMonth(periodOn: string): string {
  const date = new Date(`${periodOn}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

/** Compare the latest published monthly rate with adjacent original levels. */
export function reconcileLatestIndecMonthlyRate(input: {
  readonly level: ArgentinaIndicator;
  readonly rate: ArgentinaIndicator;
  readonly levels: readonly IndecPoint[];
  readonly rates: readonly IndecPoint[];
}): IndecMonthlyReconciliation {
  const { level, rate, levels, rates } = input;
  if (
    level.sourceId !== "indec-api" ||
    level.externalId !== rate.externalId ||
    level.frequency !== "monthly" ||
    rate.frequency !== "monthly" ||
    (level.currency !== "index" && level.currency !== "ARS") ||
    rate.currency !== "percent" ||
    JSON.stringify(publishedMonthlyRateIndicator(level).filters) !==
      JSON.stringify(rate.filters)
  ) {
    return { status: "refused", reason: "incompatible_series" };
  }

  const current = levels.at(-1);
  const previous = levels.at(-2);
  const published = rates.at(-1);
  if (
    !current ||
    !previous ||
    !published ||
    nextMonth(previous.periodOn) !== current.periodOn ||
    published.periodOn !== current.periodOn
  ) {
    return { status: "refused", reason: "incompatible_period" };
  }
  if (
    current.value === null ||
    previous.value === null ||
    published.value === null
  ) {
    return { status: "refused", reason: "missing_value" };
  }

  const d = createDecimalOperations((code) => new Error(code));
  try {
    const base = d.parseDecimal(previous.value, "previous");
    const last = d.parseDecimal(current.value, "current");
    if (base.lte(0) || last.lte(0)) {
      return { status: "refused", reason: "non_positive_level" };
    }
    const rateValue = d.parseDecimal(published.value, "published");
    const computed = d.divide(last, base, "rate").minus(1).mul(100);
    const difference = computed.minus(rateValue).abs();
    if (difference.gt(d.parseDecimal(MAX_DIFFERENCE_PP, "tolerance"))) {
      return { status: "refused", reason: "published_mismatch" };
    }
    return {
      status: "matched",
      periodOn: current.periodOn,
      computed: d.formatDecimal(computed, "computed"),
      published: published.value,
      differencePp: d.formatDecimal(difference, "difference"),
      version: INDEC_MONTHLY_RECONCILIATION_VERSION,
    };
  } catch {
    return { status: "refused", reason: "invalid_value" };
  }
}
