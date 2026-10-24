import type { PriceEvent } from "@/modules/prices/domain/daily-close";
import type { CedearRatio } from "@/modules/cedears/domain/cedear-claim";
import { divide, formatDecimal, parseDecimal, ZERO } from "./decimal-policy";
import type { MarketClose, MarketPriceComparison } from "./market-implied";

export const CEDEAR_PESO_VALUE_VERSION = "cedear-peso-value-1.0.0";
export type CedearPesoUnavailable =
  | "no_byma_symbol"
  | "no_ratio"
  | "invalid_ratio"
  | "no_cedear_close_at_as_of"
  | "underlying_not_comparable"
  | "currency_mismatch"
  | "non_positive_close"
  | "invalid_number"
  | "ratio_after_price_date"
  | "split_after_ratio_basis";
export type CedearPesoValue = {
  readonly version: typeof CEDEAR_PESO_VALUE_VERSION;
} & (
  | {
      readonly status: "computed";
      readonly price: MarketClose;
      readonly underlyingPrice: MarketClose;
      readonly implicitCcl: string;
      readonly valueArs: string;
    }
  | { readonly status: "unavailable"; readonly reason: CedearPesoUnavailable }
);

/** Same-day raw closes. A conversion of the USD value, not a new valuation. */
export function cedearPesoValue(input: {
  readonly asOf: string;
  readonly symbol: string | null;
  readonly ratio: CedearRatio | null;
  readonly ratioKnownOn: string | null;
  readonly events: readonly Pick<PriceEvent, "eventType" | "effectiveOn">[];
  readonly comparison: MarketPriceComparison;
  readonly closes: readonly MarketClose[];
}): CedearPesoValue {
  const unavailable = (reason: CedearPesoUnavailable): CedearPesoValue => ({
    status: "unavailable",
    version: CEDEAR_PESO_VALUE_VERSION,
    reason,
  });
  if (input.symbol === null) return unavailable("no_byma_symbol");
  if (input.ratio === null) return unavailable("no_ratio");
  if (input.ratioKnownOn === null || input.ratioKnownOn > input.asOf)
    return unavailable("ratio_after_price_date");
  if (
    input.events.some(
      (event) =>
        event.eventType === "split" &&
        event.effectiveOn >= input.ratioKnownOn! &&
        event.effectiveOn <= input.asOf,
    )
  )
    return unavailable("split_after_ratio_basis");
  if (input.comparison.status !== "compared")
    return unavailable("underlying_not_comparable");
  const storedPrice = input.closes.find((row) => row.marketDate === input.asOf);
  if (storedPrice === undefined) return unavailable("no_cedear_close_at_as_of");
  const price: MarketClose = {
    marketDate: storedPrice.marketDate,
    close: storedPrice.close,
    currency: storedPrice.currency,
  };
  const underlying = input.comparison.price;
  if (price.currency !== "ARS" || underlying.currency !== "USD")
    return unavailable("currency_mismatch");
  if (underlying.marketDate !== input.asOf)
    return unavailable("underlying_not_comparable");
  try {
    const depositary = parseDecimal(
      input.ratio.depositaryUnits,
      "depositaryUnits",
    );
    const units = parseDecimal(input.ratio.underlyingUnits, "underlyingUnits");
    if (!depositary.gt(ZERO) || !units.gt(ZERO))
      return unavailable("invalid_ratio");
    const ars = parseDecimal(price.close, "cedearClose");
    const usd = parseDecimal(underlying.close, "underlyingClose");
    if (!ars.gt(ZERO) || !usd.gt(ZERO))
      return unavailable("non_positive_close");
    const ccl = divide(ars.times(depositary), usd.times(units), "implicitCcl");
    const value = divide(
      parseDecimal(input.comparison.valuePerShare, "valuePerShare").times(
        units,
      ),
      depositary,
      "cedearUsd",
    ).times(ccl);
    return {
      status: "computed",
      version: CEDEAR_PESO_VALUE_VERSION,
      price,
      underlyingPrice: underlying,
      implicitCcl: formatDecimal(ccl, "implicitCcl"),
      valueArs: formatDecimal(value, "cedearValueArs"),
    };
  } catch {
    return unavailable("invalid_number");
  }
}
