import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { computeFcff } from "./fcff";
import { checkValuationInput } from "./policy-checks";
import { valueScenarios } from "./scenario-valuation";
import {
  materializeScenario,
  scenarioDriverMismatches,
  scenarioSchema,
  type Scenario,
} from "./scenarios";
import {
  computeValuationInputHash,
  valuationInputSchema,
  type ValuationInput,
} from "./valuation-input";
import { isValuationPolicyError } from "./valuation-error";

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

function scenario(drivers: Scenario["drivers"]): Scenario {
  return scenarioSchema.parse({ thesis: "Test thesis.", drivers });
}

const scenarios = () => {
  if (DEMO_VALUATION_INPUT.scenarios === null) {
    throw new Error("The demo snapshot declares scenarios.");
  }

  return DEMO_VALUATION_INPUT.scenarios;
};

function rejectionOf(action: () => unknown) {
  try {
    action();
  } catch (error) {
    if (isValuationPolicyError(error)) {
      return { code: error.code, subjects: error.subjects };
    }

    throw error;
  }

  throw new Error("Expected a policy rejection.");
}

describe("materializeScenario", () => {
  it("replaces only the declared drivers and keeps everything else", () => {
    const bear = materializeScenario(DEMO_VALUATION_INPUT, scenarios().bear);

    expect(bear.periods.map((period) => period.revenueGrowth)).toStrictEqual([
      "0.05",
      "0.045",
      "0.04",
      "0.035",
      "0.03",
    ]);
    expect(bear.periods.every((period) => period.ebitMargin === "0.15")).toBe(
      true,
    );
    expect(bear.terminal).toStrictEqual({
      ...DEMO_VALUATION_INPUT.terminal,
      growth: "0.015",
      ebitMargin: "0.15",
      returnOnCapital: "0.09",
    });
    // Lo que un escenario no mueve: costo de capital, tasa, hechos y puente.
    expect(
      bear.periods.map((period) => [period.wacc, period.taxRate]),
    ).toStrictEqual(
      DEMO_VALUATION_INPUT.periods.map((period) => [
        period.wacc,
        period.taxRate,
      ]),
    );
    expect(bear.costOfCapital).toStrictEqual(
      DEMO_VALUATION_INPUT.costOfCapital,
    );
    expect(bear.baseRevenue).toStrictEqual(DEMO_VALUATION_INPUT.baseRevenue);
    expect(bear.bridge).toStrictEqual(DEMO_VALUATION_INPUT.bridge);
    expect(bear.scenarios).toBeNull();
    expect(bear.sensitivity).toBeNull();
    expect(() => valuationInputSchema.parse(bear)).not.toThrow();
  });

  it("leaves a period untouched where the driver says null", () => {
    const input = materializeScenario(
      DEMO_VALUATION_INPUT,
      scenario([
        {
          driver: "salesToCapital",
          values: [null, null, "2", null, null],
          rationale: "Heavier capex in year three.",
        },
      ]),
    );

    expect(
      input.periods.map((period) =>
        period.reinvestment.convention === "sales_to_capital"
          ? period.reinvestment.salesToCapital
          : null,
      ),
    ).toStrictEqual(["2.5", "2.5", "2", "2.5", "2.5"]);
  });

  it("does not mutate the base snapshot", () => {
    const before = structuredClone(DEMO_VALUATION_INPUT);

    materializeScenario(DEMO_VALUATION_INPUT, scenarios().bull);

    expect(DEMO_VALUATION_INPUT).toStrictEqual(before);
  });
});

describe("scenarioDriverMismatches", () => {
  it("accepts the demo scenarios", () => {
    expect(
      scenarioDriverMismatches(DEMO_VALUATION_INPUT, "bear", scenarios().bear),
    ).toStrictEqual([]);
    expect(
      scenarioDriverMismatches(DEMO_VALUATION_INPUT, "bull", scenarios().bull),
    ).toStrictEqual([]);
  });

  it("needs one value per explicit period", () => {
    expect(
      scenarioDriverMismatches(
        DEMO_VALUATION_INPUT,
        "bear",
        scenario([
          {
            driver: "revenueGrowth",
            values: ["0.05", "0.04"],
            rationale: "Too short.",
          },
        ]),
      ),
    ).toStrictEqual(["scenarios.bear.drivers.0.values"]);
  });

  it("rejects a driver that changes no period", () => {
    expect(
      scenarioDriverMismatches(
        DEMO_VALUATION_INPUT,
        "bull",
        scenario([
          {
            driver: "ebitMargin",
            values: [null, null, null, null, null],
            rationale: "Nothing.",
          },
        ]),
      ),
    ).toStrictEqual(["scenarios.bull.drivers.0.values"]);
  });

  it("rejects a declared value equal to the base, by decimal value", () => {
    expect(
      scenarioDriverMismatches(
        DEMO_VALUATION_INPUT,
        "bear",
        scenario([
          {
            driver: "revenueGrowth",
            values: ["0.080", "0.05", null, null, null],
            rationale: "First period equals the base.",
          },
          {
            driver: "terminalReturnOnCapital",
            value: "0.12",
            rationale: "Equals the base.",
          },
        ]),
      ),
    ).toStrictEqual([
      "scenarios.bear.drivers.0.values.0",
      "scenarios.bear.drivers.1.value",
    ]);
  });

  it("rejects a reinvestment driver outside the period's convention", () => {
    expect(
      scenarioDriverMismatches(
        DEMO_VALUATION_INPUT,
        "bear",
        scenario([
          {
            driver: "returnOnCapital",
            values: ["0.1", null, null, null, null],
            rationale: "The base uses sales-to-capital.",
          },
        ]),
      ),
    ).toStrictEqual(["scenarios.bear.drivers.0.values.0"]);
  });

  it("refuses a scenario that declares a driver twice", () => {
    expect(() =>
      scenarioSchema.parse({
        thesis: "Twice.",
        drivers: [
          { driver: "terminalGrowth", value: "0.01", rationale: "One." },
          { driver: "terminalGrowth", value: "0.015", rationale: "Two." },
        ],
      }),
    ).toThrow(/at most once/u);
  });

  it("refuses a scenario without drivers or without a rationale", () => {
    expect(() =>
      scenarioSchema.parse({ thesis: "Empty.", drivers: [] }),
    ).toThrow();
    expect(() =>
      scenarioSchema.parse({
        thesis: "No reason.",
        drivers: [{ driver: "terminalGrowth", value: "0.01", rationale: " " }],
      }),
    ).toThrow();
  });

  it("is a reject check of the snapshot, with field paths only", () => {
    const input = draft((candidate) => {
      candidate.scenarios!.bull.drivers[2] = {
        driver: "terminalGrowth",
        value: "0.02",
        rationale: "Equals the base.",
      };
    });

    expect(
      checkValuationInput(input).find(
        (entry) => entry.id === "scenario_drivers_declared",
      ),
    ).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["scenarios.bull.drivers.2.value"],
    });
  });
});

describe("valueScenarios", () => {
  it("returns null without scenarios", () => {
    const input = draft((candidate) => {
      candidate.scenarios = null;
    });

    expect(valueScenarios(input, computeFcff(input))).toBeNull();
  });

  it("values each scenario as the full run of its own snapshot, not a multiplier", () => {
    const base = computeFcff(DEMO_VALUATION_INPUT);
    const valuation = valueScenarios(DEMO_VALUATION_INPUT, base);

    for (const key of ["bear", "bull"] as const) {
      const independent = computeFcff(
        materializeScenario(DEMO_VALUATION_INPUT, scenarios()[key]),
      );

      expect(valuation?.[key]).toMatchObject({
        periods: independent.periods,
        terminal: independent.terminal,
        enterpriseValue: independent.enterpriseValue,
        equityValue: independent.equityValue,
        valuePerShare: independent.valuePerShare,
      });
    }

    // Un multiplicador escalaría la proyección entera por un mismo factor; un
    // conjunto de supuestos no: los ingresos y los flujos se mueven distinto.
    const bear = valuation!.bear;
    const revenueRatio = (index: number) =>
      Number(bear.periods[index]!.revenue) /
      Number(base.periods[index]!.revenue);

    expect(revenueRatio(0)).not.toBeCloseTo(revenueRatio(4), 6);
    expect(
      Number(bear.enterpriseValue) / Number(base.enterpriseValue),
    ).not.toBeCloseTo(Number(bear.equityValue) / Number(base.equityValue), 6);
  });

  it("orders the demo bear, base and bull", () => {
    const base = computeFcff(DEMO_VALUATION_INPUT);
    const valuation = valueScenarios(DEMO_VALUATION_INPUT, base)!;

    expect(valuation.bear.valuePerShare).toBe(
      "9.376641738583190225603041202724",
    );
    expect(valuation.bull.valuePerShare).toBe(
      "17.4046494186589953620028649548966",
    );
    expect(valuation.orderCheck).toMatchObject({
      id: "scenario_value_order",
      mode: "require_review",
      status: "passed",
    });
  });

  it("rejects a scenario the base's checks would reject, naming the scenario", () => {
    const input = draft((candidate) => {
      candidate.scenarios!.bull.drivers[2] = {
        driver: "terminalGrowth",
        value: "0.045",
        rationale: "Above the 4 % risk-free rate.",
      };
    });

    expect(
      rejectionOf(() => valueScenarios(input, computeFcff(input))),
    ).toStrictEqual({
      code: "policy_check_failed",
      subjects: [
        "scenarios.bull:terminal.growth",
        "scenarios.bull:costOfCapital.derived.riskFree",
      ],
    });
  });

  it("rejects a scenario with a non-positive sales-to-capital", () => {
    const input = draft((candidate) => {
      candidate.scenarios!.bear.drivers.push({
        driver: "salesToCapital",
        values: [null, "0", null, null, null],
        rationale: "Division by zero.",
      });
    });

    expect(
      rejectionOf(() => valueScenarios(input, computeFcff(input))),
    ).toStrictEqual({
      code: "policy_check_failed",
      subjects: ["scenarios.bear:periods.1.reinvestment"],
    });
  });

  it("marks reversed values for review instead of rejecting", () => {
    const input = draft((candidate) => {
      const { bear, bull } = candidate.scenarios!;
      candidate.scenarios!.bear = bull;
      candidate.scenarios!.bull = bear;
    });
    const valuation = valueScenarios(input, computeFcff(input))!;

    expect(valuation.orderCheck).toMatchObject({
      status: "failed",
      subjects: [
        "scenarios.bear.valuePerShare",
        "scenarios.bull.valuePerShare",
      ],
    });
  });

  it("keeps a scenario's own review checks", () => {
    const input = draft((candidate) => {
      candidate.scenarios!.bull.drivers[3] = {
        driver: "terminalEbitMargin",
        value: "0.65",
        rationale: "Above the review ceiling.",
      };
    });
    const valuation = valueScenarios(input, computeFcff(input))!;

    expect(
      valuation.bull.checks.find(
        (entry) => entry.id === "terminal_margin_range",
      ),
    ).toMatchObject({ status: "failed", mode: "require_review" });
    expect(
      valuation.bear.checks.every((entry) => entry.status === "passed"),
    ).toBe(true);
  });

  it("stays ordered when only the margin moves, everything else fixed", () => {
    // Con la reinversión por ventas sobre capital y un `g / ROIC` terminal fijo,
    // el flujo crece con el margen: el orden lo garantizan los supuestos.
    const margins = ["0.1", "0.14", "0.22", "0.3"];
    const values = margins.map((margin) => {
      const input = materializeScenario(
        DEMO_VALUATION_INPUT,
        scenario([
          {
            driver: "ebitMargin",
            values: DEMO_VALUATION_INPUT.periods.map(() => margin),
            rationale: "Margin only.",
          },
          {
            driver: "terminalEbitMargin",
            value: margin,
            rationale: "Margin only.",
          },
        ]),
      );

      return Number(computeFcff(input).valuePerShare);
    });

    expect([...values].sort((left, right) => left - right)).toStrictEqual(
      values,
    );
    expect(new Set(values).size).toBe(values.length);
  });

  it("changes the input hash when a scenario driver changes", () => {
    const input = draft((candidate) => {
      candidate.scenarios!.bear.drivers[2] = {
        driver: "terminalGrowth",
        value: "0.01",
        rationale: "A slower perpetuity.",
      };
    });

    expect(computeValuationInputHash(input)).not.toBe(
      computeValuationInputHash(DEMO_VALUATION_INPUT),
    );
  });
});
