import { describe, expect, it } from "vitest";

import { buildDemoValuationRun } from "../infrastructure/demo-valuation-run";
import { parseDecimal, sum } from "./decimal-policy";
import type { MarketPriceComparison } from "./market-implied";
import {
  VALUATION_VERDICT_VERSION,
  valuationVerdict,
  valueChain,
} from "./valuation-verdict";
import type { ValuationResult } from "./valuation-run";

function compared(close: string, value = "100"): MarketPriceComparison {
  return {
    status: "compared",
    version: "market-price-comparison-1.0.0",
    price: { marketDate: "2026-09-30", close, currency: "USD" },
    valuePerShare: value,
    valueToPrice: "0",
    priceToValue: parseDecimal(close, "close").dividedBy(value).toString(),
  };
}

function scenarios(bear: string, bull: string): ValuationResult["scenarios"] {
  const result = buildDemoValuationRun().result!;
  const outcome = result.scenarios!.bear;
  return {
    version: result.scenarios!.version,
    bear: { ...outcome, valuePerShare: bear },
    bull: { ...outcome, valuePerShare: bull },
  };
}

describe(VALUATION_VERDICT_VERSION, () => {
  it.each([
    ["50", "below_bear", "below"],
    ["80", "bear_to_base", "below"],
    ["100", "bear_to_base", "equal"],
    ["110", "base_to_bull", "above"],
    ["120", "base_to_bull", "above"],
    ["184", "above_bull", "above"],
  ] as const)("ubica un precio de %s en %s", (close, zone, relation) => {
    const verdict = valuationVerdict({
      comparison: compared(close),
      scenarios: scenarios("80", "120"),
    });

    expect(verdict).toMatchObject({ status: "placed", zone, relation });
  });

  it("dibuja todas las marcas en una escala común con margen", () => {
    const verdict = valuationVerdict({
      comparison: compared("184"),
      scenarios: scenarios("56", "115"),
    });

    if (verdict.status !== "placed") throw new Error("expected placed");
    const { scale } = verdict;
    expect(scale.bear!).toBeLessThan(scale.value);
    expect(scale.value).toBeLessThan(scale.bull!);
    expect(scale.bull!).toBeLessThan(scale.price);
    expect(scale.bear!).toBeGreaterThan(0);
    expect(scale.price).toBeLessThan(100);
  });

  it("sin escenarios ubica la relación pero no la zona", () => {
    const verdict = valuationVerdict({
      comparison: compared("150"),
      scenarios: null,
    });

    expect(verdict).toMatchObject({
      status: "placed",
      zone: null,
      relation: "above",
      bear: null,
      bull: null,
      scale: { bear: null, bull: null },
    });
  });

  it("un precio sin comparar no se ubica y conserva el motivo", () => {
    expect(
      valuationVerdict({
        comparison: {
          status: "unavailable",
          version: "market-price-comparison-1.0.0",
          reason: "no_close_at_as_of",
          price: null,
        },
        scenarios: null,
      }),
    ).toEqual({
      status: "unplaced",
      version: VALUATION_VERDICT_VERSION,
      reason: "no_close_at_as_of",
    });
  });
});

describe("value-chain-1.0.0", () => {
  it("separa años explícitos y terminal, y llega al valor por acción", () => {
    const result = buildDemoValuationRun().result!;
    const chain = valueChain(result);

    expect(chain.explicitYears).toBe(result.periods.length);
    expect(
      parseDecimal(chain.explicitPresentValue, "explicit")
        .plus(parseDecimal(chain.terminalPresentValue, "terminal"))
        .equals(parseDecimal(chain.goingConcernValue, "goingConcern")),
    ).toBe(true);
    expect(chain.firstYear.fcff).toBe(result.periods[0]!.fcff);
    expect(chain.lastYear.revenue).toBe(result.periods.at(-1)!.revenue);
    expect(chain.valuePerShare).toBe(result.valuePerShare);

    const bridged = sum(
      chain.bridge.map((item) =>
        parseDecimal(item.value, item.key).times(item.sign === "add" ? 1 : -1),
      ),
    ).plus(parseDecimal(chain.enterpriseValue, "ev"));
    expect(bridged.equals(parseDecimal(chain.equityValue, "equity"))).toBe(
      true,
    );
  });
});
