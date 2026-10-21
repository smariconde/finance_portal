import { describe, expect, it } from "vitest";

import { judgePlausibility } from "./market-expectations";
import type { DriverReading } from "./market-expectations-task";
import type {
  MarketImpliedContext,
  MarketImpliedReading,
} from "./market-implied";

const CONTEXT: MarketImpliedContext = {
  historicalGrowth: [],
  baseEbitMargin: "0.30",
  baseReturnOnCapital: "0.8",
  costOfEquity: "0.10",
  wacc: "0.095",
  terminalWacc: "0.08",
};

const BOUNDS = { lower: "0", upper: "1" };

function solved(
  driver: MarketImpliedReading["driver"],
  implied: string,
): MarketImpliedReading {
  return { driver, status: "solved", runValue: "0.1", implied, bounds: BOUNDS };
}

function reading(
  driver: DriverReading["driver"],
  outlook: string,
): DriverReading {
  return {
    driver,
    outlook,
    signals:
      outlook === "not_addressed"
        ? []
        : [{ direction: "higher", summary: "x", quote: "x", evidenceId: "E1" }],
  };
}

function verdict(
  driverReading: DriverReading,
  implied: readonly MarketImpliedReading[],
) {
  const [result] = judgePlausibility({
    readings: [driverReading],
    implied,
    context: CONTEXT,
  });

  return { verdict: result!.verdict, required: result!.required };
}

describe("expectations-plausibility-1.0.0", () => {
  it("places implied growth on the prompt's scale and counts the steps", () => {
    const growth = (implied: string, outlook: string) =>
      verdict(reading("revenue_growth", outlook), [
        solved("revenue_growth", implied),
      ]);

    expect(growth("0.04", "low")).toEqual({
      verdict: "within",
      required: "low",
    });
    expect(growth("0.08", "low")).toEqual({
      verdict: "above",
      required: "moderate",
    });
    expect(growth("0.18", "low")).toEqual({
      verdict: "far_above",
      required: "high",
    });
    expect(growth("0.25", "very_high")).toEqual({
      verdict: "within",
      required: "very_high",
    });
    expect(growth("-0.01", "low")).toEqual({
      verdict: "within",
      required: "decline",
    });
  });

  it("reads the margin as the change it requires against the base year", () => {
    const margin = (implied: string, outlook: string) =>
      verdict(reading("operating_margin", outlook), [
        solved("ebit_margin", implied),
      ]);

    expect(margin("0.31", "stable")).toEqual({
      verdict: "within",
      required: "stable",
    });
    expect(margin("0.40", "stable")).toEqual({
      verdict: "above",
      required: "expanding",
    });
    // Más de quince puntos: un escalón más allá de «se expande».
    expect(margin("0.62", "expanding").verdict).toBe("above");
    expect(margin("0.62", "contracting").verdict).toBe("far_above");
  });

  it("reads the advantage as the spread of the implied ROIC over the terminal WACC", () => {
    const advantage = (implied: string, outlook: string) =>
      verdict(reading("competitive_advantage", outlook), [
        solved("terminal_return_on_capital", implied),
      ]);

    expect(advantage("0.09", "none")).toEqual({
      verdict: "within",
      required: "none",
    });
    expect(advantage("0.40", "narrow")).toEqual({
      verdict: "above",
      required: "wide",
    });
  });

  it("names a price no driver reaches, a missing requirement and an unaddressed driver", () => {
    expect(
      verdict(reading("competitive_advantage", "wide"), [
        {
          driver: "terminal_return_on_capital",
          status: "price_above_range",
          runValue: "0.4",
          bounds: BOUNDS,
          closestValuePerShare: "191",
        },
      ]).verdict,
    ).toBe("unreachable");
    expect(verdict(reading("revenue_growth", "low"), []).verdict).toBe(
      "no_requirement",
    );
    expect(
      verdict(reading("revenue_growth", "not_addressed"), [
        solved("revenue_growth", "0.18"),
      ]),
    ).toEqual({ verdict: "not_addressed", required: "high" });
  });
});
