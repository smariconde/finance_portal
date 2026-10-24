import { describe, it, expect } from "vitest";
import { cedearPesoValue } from "./cedear-peso-value";
import type { MarketPriceComparison } from "./market-implied";

const comparison: MarketPriceComparison = {
  status: "compared",
  version: "market-price-comparison-1.0.0",
  price: { marketDate: "2026-10-23", close: "200", currency: "USD" },
  valuePerShare: "150",
  valueToPrice: "-0.25",
  priceToValue: "1.33333333333333",
};
const input = {
  asOf: "2026-10-23",
  ratioKnownOn: "2026-09-23",
  events: [],
  symbol: "LOCAL",
  ratio: { depositaryUnits: "20", underlyingUnits: "1" },
  comparison,
  closes: [{ marketDate: "2026-10-23", close: "15000", currency: "ARS" }],
};

describe("cedear-peso-value-1.0.0", () => {
  it("uses an independent hand calculation and preserves the relative discount", () => {
    const result = cedearPesoValue(input);
    expect(result).toMatchObject({
      status: "computed",
      implicitCcl: "1500",
      valueArs: "11250",
    });
  });
  it("supports a fractional ratio without binary floating point", () => {
    expect(
      cedearPesoValue({
        ...input,
        ratio: { depositaryUnits: "1", underlyingUnits: "4" },
      }),
    ).toMatchObject({ implicitCcl: "18.75", valueArs: "11250" });
  });
  it.each([
    [{ symbol: null }, "no_byma_symbol"],
    [{ ratio: null }, "no_ratio"],
    [{ ratioKnownOn: "2026-10-24" }, "ratio_after_price_date"],
    [
      { events: [{ eventType: "split", effectiveOn: "2026-10-22" }] },
      "split_after_ratio_basis",
    ],
    [
      { ratio: { depositaryUnits: "0", underlyingUnits: "1" } },
      "invalid_ratio",
    ],
    [
      { ratio: { depositaryUnits: "-2", underlyingUnits: "1" } },
      "invalid_ratio",
    ],
    [{ closes: [] }, "no_cedear_close_at_as_of"],
    [
      { closes: [{ ...input.closes[0]!, marketDate: "2026-10-22" }] },
      "no_cedear_close_at_as_of",
    ],
    [
      { closes: [{ ...input.closes[0]!, currency: "USD" }] },
      "currency_mismatch",
    ],
    [{ closes: [{ ...input.closes[0]!, close: "0" }] }, "non_positive_close"],
    [{ closes: [{ ...input.closes[0]!, close: "-3" }] }, "non_positive_close"],
    [{ closes: [{ ...input.closes[0]!, close: "NaN" }] }, "invalid_number"],
    [
      { closes: [{ ...input.closes[0]!, close: "Infinity" }] },
      "invalid_number",
    ],
  ] as const)("names missing or incompatible inputs %j", (patch, reason) => {
    expect(cedearPesoValue({ ...input, ...patch })).toMatchObject({
      status: "unavailable",
      reason,
    });
  });
  it("propagates an unavailable USD comparison, including splits or a rejected run", () => {
    expect(
      cedearPesoValue({
        ...input,
        comparison: {
          status: "unavailable",
          version: "market-price-comparison-1.0.0",
          reason: "split_after_share_basis",
          price: null,
        },
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "underlying_not_comparable",
    });
  });
  it("never selects a later close", () => {
    expect(
      cedearPesoValue({
        ...input,
        closes: [{ ...input.closes[0]!, marketDate: "2026-10-24" }],
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "no_cedear_close_at_as_of",
    });
  });
});
