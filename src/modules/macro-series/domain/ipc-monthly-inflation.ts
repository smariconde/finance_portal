import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

import type {
  ArgentinaIndicator,
  ArgentinaIndicatorVintage,
} from "./argentina-indicator";

export const IPC_MONTHLY_INFLATION_VERSION = "ipc-monthly-index-change-1.0.0";
const decimal = createDecimalOperations((code) => new Error(code));

export type IpcMonthlyInflation =
  | {
      readonly status: "computed";
      readonly targetMonth: string;
      readonly monthlyPercent: string;
      readonly availableAt: string;
      readonly version: typeof IPC_MONTHLY_INFLATION_VERSION;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "missing_period"
        | "missing_value"
        | "incompatible_basis"
        | "invalid_index";
    };

/** National, original IPC index in two adjacent months; no interpolated months. */
export function ipcMonthlyInflation(input: {
  readonly indicator: ArgentinaIndicator;
  readonly previous: ArgentinaIndicatorVintage | null;
  readonly current: ArgentinaIndicatorVintage | null;
}): IpcMonthlyInflation {
  const { indicator, previous, current } = input;
  if (
    indicator.id !== "ipc_nacional" ||
    indicator.currency !== "index" ||
    indicator.frequency !== "monthly" ||
    indicator.seasonalAdjustment !== "original" ||
    indicator.indexBase === null
  )
    return { status: "unavailable", reason: "incompatible_basis" };
  if (previous === null || current === null)
    return { status: "unavailable", reason: "missing_period" };
  const next = new Date(`${previous.periodOn.slice(0, 7)}-01T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (
    next.toISOString().slice(0, 7) !== current.periodOn.slice(0, 7) ||
    previous.indicatorId !== indicator.id ||
    current.indicatorId !== indicator.id ||
    previous.segment !== current.segment ||
    current.segment !== indicator.segment
  )
    return { status: "unavailable", reason: "incompatible_basis" };
  if (previous.value === null || current.value === null)
    return { status: "unavailable", reason: "missing_value" };
  try {
    const before = decimal.parseDecimal(previous.value, "previous");
    const after = decimal.parseDecimal(current.value, "current");
    if (before.lte(0) || after.lte(0))
      return { status: "unavailable", reason: "invalid_index" };
    const monthlyPercent = decimal.formatDecimal(
      decimal.divide(after, before, "monthlyPercent").minus(1).mul(100),
      "monthlyPercent",
    );
    return {
      status: "computed",
      targetMonth: current.periodOn.slice(0, 7),
      monthlyPercent,
      availableAt:
        previous.availableAt > current.availableAt
          ? previous.availableAt
          : current.availableAt,
      version: IPC_MONTHLY_INFLATION_VERSION,
    };
  } catch {
    return { status: "unavailable", reason: "invalid_index" };
  }
}
