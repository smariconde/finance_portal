import { createDecimalOperations } from "@/modules/numeric/domain/decimal-policy";

export const WHOLESALE_BAND_POSITION_VERSION = "wholesale-band-position-1.0.0";

export type WholesaleBandPosition =
  | {
      readonly status: "computed";
      readonly on: string;
      /** A fraction; values outside [0, 1] remain outside. */
      readonly position: string;
      /** Signed pesos per dollar, measured from the official quote. */
      readonly toFloor: string;
      readonly toCeiling: string;
      readonly official: string;
      readonly low: string;
      readonly high: string;
    }
  | {
      readonly status: "unavailable";
      readonly on: string | null;
      readonly reason:
        | "missing_official"
        | "missing_same_day_band"
        | "invalid_band"
        | "invalid_value";
    };

const decimal = createDecimalOperations((code) => new Error(code));

/** All three inputs are BCRA pesos per US dollar for the exact same date. */
export function wholesaleBandPosition(input: {
  readonly on: string | null;
  readonly official: string | null;
  readonly low: string | null;
  readonly high: string | null;
}): WholesaleBandPosition {
  if (input.on === null || input.official === null) {
    return { status: "unavailable", on: input.on, reason: "missing_official" };
  }
  if (input.low === null || input.high === null) {
    return {
      status: "unavailable",
      on: input.on,
      reason: "missing_same_day_band",
    };
  }
  try {
    const official = decimal.parseDecimal(input.official, "official");
    const low = decimal.parseDecimal(input.low, "low");
    const high = decimal.parseDecimal(input.high, "high");
    if (high.lessThanOrEqualTo(low)) {
      return { status: "unavailable", on: input.on, reason: "invalid_band" };
    }
    const position = decimal.divide(
      official.minus(low),
      high.minus(low),
      "position",
    );
    return {
      status: "computed",
      on: input.on,
      position: decimal.formatDecimal(position, "position"),
      toFloor: decimal.formatDecimal(official.minus(low), "toFloor"),
      toCeiling: decimal.formatDecimal(high.minus(official), "toCeiling"),
      official: input.official,
      low: input.low,
      high: input.high,
    };
  } catch {
    return { status: "unavailable", on: input.on, reason: "invalid_value" };
  }
}
