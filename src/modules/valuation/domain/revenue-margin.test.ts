import { describe, expect, it } from "vitest";
import { runValuation } from "../application/run-valuation";
import { replayValuationRun } from "../application/replay-valuation-run";
import { fixtureGrowthValuation } from "../infrastructure/fixture-growth-valuation";
import { deriveRevenueMargin, computeLossTax } from "./revenue-margin";
import { parseDecimal } from "./decimal-policy";
import { selectValuationMethod } from "./method-selection";
import { SCENARIO_SET_VERSION } from "./scenarios";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

const deps = {
  now: () => "2025-07-01T00:00:00.000Z",
  newValuationRunId: () => "11111111-1111-4111-8111-111111111111",
};
const run = (input = fixtureGrowthValuation()) => runValuation(input, deps);
function rebuild(input: ValuationInput) {
  const path = deriveRevenueMargin(
    input.revenueMargin!,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
    input.terminal.growth,
  );
  input.periods.forEach((period, i) => {
    period.ebitMargin = path.periodMargins[i]!;
    period.revenueGrowth = path.periodGrowth[i]!;
  });
  input.terminal.ebitMargin = input.revenueMargin!.targetMargin;
}

describe("revenue-to-margin and survival", () => {
  it.each(["high_growth", "loss_making"] as const)(
    "admits %s only with its own snapshot, experimental screening and replay",
    (profile) => {
      const input = fixtureGrowthValuation(profile);
      const result = run(input);
      expect(result.status).toBe("requires_review");
      expect(result.input.assessment.rigor.level).toBe("screening");
      expect(result.result!.growthDiagnostics!.periodGrowth).toEqual([
        "0.3",
        "0.3",
        "0.2066666666666666666666666666666667",
        "0.1133333333333333333333333333333333",
        "0.02",
      ]);
      expect(result.result!.growthDiagnostics!.modelStatus).toBe(
        "experimental",
      );
      expect(result.provenance.sourceIds).toContain("fixture-growth-tax");
      expect(replayValuationRun(result).outcome).toBe("reproduced");
    },
  );

  it("includes negative EBIT and FCFF, adds losses without a refund and exposes funding need", () => {
    const result = run().result!;
    const first = result.periods[0]!;
    expect(first.ebit).toBe("-12480000");
    expect(first.nopat).toBe(first.ebit);
    expect(first.lossTax).toEqual({
      opening: "10000000",
      used: "0",
      closing: "22480000",
      taxableIncome: "0",
      taxes: "0",
    });
    expect(Number(first.fcff)).toBeLessThan(Number(first.ebit));
    expect(Number(result.growthDiagnostics!.peakFundingNeed)).toBeGreaterThan(
      -Number(first.fcff),
    );
    expect(result.periods[1]!.lossTax!.closing).toBe(first.lossTax!.closing);
    // Last forecast is stable growth and margin; the loss balance is not a perpetuity shield.
    expect(result.periods.at(-1)!.revenueChange).not.toBe("0");
    expect(Number(result.terminal.nopat)).toBeCloseTo(
      Number(result.terminal.ebit) * 0.75,
      6,
    );
  });

  it("keeps loss utilization within the explicit annual cap", () => {
    const d = (x: string) => parseDecimal(x, "test");
    const tax = computeLossTax(d("100"), d("200"), d("0.25"), d("0.8"));
    expect(tax.trace).toEqual({
      opening: "200",
      used: "80",
      closing: "120",
      taxableIncome: "20",
      taxes: "5",
    });
    expect(tax.nopat.toString()).toBe("95");
    const zero = computeLossTax(d("0"), d("200"), d("0.25"), d("0.8"));
    expect(zero.trace.closing).toBe("200");
    expect(zero.trace.taxes).toBe("0");
  });

  it("does not assume missing survival probability is zero", () => {
    const input = fixtureGrowthValuation();
    input.failureRisk = {
      version: "failure-risk-1.0.0",
      basis: "missing",
      reason: "no_evidence",
    };
    expect(run(input).status).toBe("rejected");
  });

  it("requires the growth-specific preflight even when industrial inputs are complete", () => {
    const input = fixtureGrowthValuation();
    const selection = selectValuationMethod({
      legalEntityId: input.subject.legalEntityId,
      knowledge: input.knowledge,
      evidence: input.revenueMargin!.profileEvidence,
      fcffInputsComplete: true,
    });
    expect(selection.status).toBe("unsupported_method");
    expect(selection.unsupportedReasons).toEqual(["missing_required_input"]);
    expect(selection.requiredInputs).toContain("loss_carryforward");
  });

  it.each(["0.1", "0.25", "0.4"])(
    "raises value with a higher target margin %s, everything else fixed",
    (margin) => {
      const input = fixtureGrowthValuation();
      input.revenueMargin!.targetMargin = "0.08";
      rebuild(input);
      const base = run(input).result!;
      input.revenueMargin!.targetMargin = margin;
      rebuild(input);
      const changed = run(input).result!;
      expect(Number(changed.valuePerShare)).toBeGreaterThan(
        Number(base.valuePerShare),
      );
    },
  );

  it("applies failure and the employee option claim once, including probability endpoints", () => {
    const input = fixtureGrowthValuation();
    if (input.failureRisk.basis !== "rating_table") throw new Error("fixture");
    input.failureRisk.parameter.value = "0";
    const survival = run(input).result!;
    input.failureRisk.parameter.value = "1";
    const failure = run(input).result!;
    expect(failure.enterpriseValue).toBe("44000000");
    expect(Number(survival.enterpriseValue)).toBeGreaterThan(
      Number(failure.enterpriseValue),
    );
    expect(
      failure.bridgeComponents.filter((item) => item.key === "employeeOptions"),
    ).toHaveLength(1);
    expect(failure.shareCount).toBe(survival.shareCount);
  });

  it("recalculates scenario margins and growth transition with the same tax and survival rules", () => {
    const input = fixtureGrowthValuation();
    input.scenarios = {
      version: SCENARIO_SET_VERSION,
      bear: {
        thesis: "Weak economics",
        drivers: [
          {
            driver: "terminalEbitMargin",
            value: "0.1",
            rationale: "Lower sustainable margin",
          },
        ],
      },
      bull: {
        thesis: "Better economics",
        drivers: [
          {
            driver: "terminalEbitMargin",
            value: "0.3",
            rationale: "Higher sustainable margin",
          },
        ],
      },
    };
    const result = run(input);
    expect(result.status).toBe("requires_review");
    expect(Number(result.result!.scenarios!.bear.valuePerShare)).toBeLessThan(
      Number(result.result!.valuePerShare),
    );
    expect(
      Number(result.result!.scenarios!.bull.valuePerShare),
    ).toBeGreaterThan(Number(result.result!.valuePerShare));
    expect(result.result!.scenarios!.bear.periods[0]!.ebit).not.toBe(
      result.result!.periods[0]!.ebit,
    );
    expect(
      result.result!.scenarios!.bear.periods[0]!.lossTax!.closing,
    ).not.toBe(result.result!.periods[0]!.lossTax!.closing);
    input.scenarios.bear.drivers = [
      {
        driver: "terminalGrowth",
        value: "0.01",
        rationale: "Lower steady growth",
      },
    ];
    expect(
      run(input).result!.scenarios!.bear.periods.at(-1)!.revenueChange,
    ).not.toBe(result.result!.periods.at(-1)!.revenueChange);
    input.scenarios.bear.drivers = [
      {
        driver: "ebitMargin",
        values: input.periods.map(() => "0.1"),
        rationale: "Bypass path",
      },
    ];
    expect(run(input).status).toBe("rejected");
  });

  it("rejects a scenario with a forged revenue path and names its scope", () => {
    const input = fixtureGrowthValuation();
    input.scenarios = {
      version: SCENARIO_SET_VERSION,
      bear: {
        thesis: "Forged growth",
        drivers: [
          {
            driver: "revenueGrowth",
            values: ["0.2", "0.2", "0.2", "0.2", "0.2"],
            rationale: "Missing convergence",
          },
        ],
      },
      bull: {
        thesis: "Higher margin",
        drivers: [
          {
            driver: "terminalEbitMargin",
            value: "0.3",
            rationale: "Higher efficiency",
          },
        ],
      },
    };
    expect(
      run(input).failure!.subjects.some((path) =>
        path.startsWith("scenarios.bear:"),
      ),
    ).toBe(true);
  });

  it("keeps the sensitivity base cell and rejects terminal growth above risk free", () => {
    const input = fixtureGrowthValuation();
    input.sensitivity!.terminalGrowth = {
      from: "0.02",
      to: "0.06",
      step: "0.02",
    };
    const result = run(input).result!;
    const row = result.sensitivity!.rows.find(
      (row) => row.wacc === input.terminal.wacc,
    )!;
    expect(row.cells[0]).toEqual({
      status: "computed",
      valuePerShare: result.valuePerShare,
    });
    expect(row.cells.at(-1)!.status).toBe("rejected");
  });

  it.each([
    [
      "missing plan",
      (x: ValuationInput) => {
        delete x.revenueMargin;
      },
    ],
    [
      "missing loss pool",
      (x: ValuationInput) => {
        x.revenueMargin!.lossCarryforward = null;
      },
    ],
    [
      "negative loss pool",
      (x: ValuationInput) => {
        x.revenueMargin!.lossCarryforward!.value = "-1";
      },
    ],
    [
      "currency mismatch",
      (x: ValuationInput) => {
        x.revenueMargin!.lossCarryforward!.currency = "EUR";
      },
    ],
    [
      "late loss pool",
      (x: ValuationInput) => {
        x.revenueMargin!.lossCarryforward!.availableAt =
          "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "undocumented losses",
      (x: ValuationInput) => {
        x.revenueMargin!.lossCarryforward!.sourceDocumentId = null;
      },
    ],
    [
      "late thesis",
      (x: ValuationInput) => {
        x.revenueMargin!.declaredAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "late note",
      (x: ValuationInput) => {
        x.revenueMargin!.employeeEquityAvailableAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "late rate",
      (x: ValuationInput) => {
        x.costOfCapital.parameters[0]!.availableAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "late base fact",
      (x: ValuationInput) => {
        x.baseRevenue.availableAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "system-recorded cutoff",
      (x: ValuationInput) => {
        x.knowledge.knowledgeBasis = "system_recorded";
      },
    ],
    [
      "another entity",
      (x: ValuationInput) => {
        x.revenueMargin!.profileEvidence[0]!.legalEntityId =
          "22222222-2222-4222-8222-222222222222";
      },
    ],
    [
      "future deciding profile",
      (x: ValuationInput) => {
        x.revenueMargin!.profileEvidence.find(
          (e) => e.profile === "loss_making",
        )!.availableAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "all high growth, no transition",
      (x: ValuationInput) => {
        x.revenueMargin!.highGrowthYears = x.periods.length;
      },
    ],
    [
      "margin beyond forecast",
      (x: ValuationInput) => {
        x.revenueMargin!.marginConvergenceYears = 6;
      },
    ],
    [
      "no sustainable profit",
      (x: ValuationInput) => {
        x.revenueMargin!.targetMargin = "0";
        rebuild(x);
      },
    ],
    [
      "negative cap",
      (x: ValuationInput) => {
        x.revenueMargin!.lossOffsetLimit = "-0.1";
      },
    ],
    [
      "cap above one",
      (x: ValuationInput) => {
        x.revenueMargin!.lossOffsetLimit = "1.1";
      },
    ],
    [
      "negative tax",
      (x: ValuationInput) => {
        x.periods[0]!.taxRate = "-0.1";
      },
    ],
    [
      "zero sales",
      (x: ValuationInput) => {
        x.baseRevenue.value = "0";
      },
    ],
    [
      "negative sales",
      (x: ValuationInput) => {
        x.baseRevenue.value = "-1";
      },
    ],
    [
      "incorrect margin path",
      (x: ValuationInput) => {
        x.periods[0]!.ebitMargin = "0.2";
      },
    ],
    [
      "incorrect growth path",
      (x: ValuationInput) => {
        x.periods[0]!.revenueGrowth = "0.7";
      },
    ],
    [
      "negative reinvestment ratio",
      (x: ValuationInput) => {
        x.periods[0]!.reinvestment = {
          convention: "sales_to_capital",
          salesToCapital: "-1",
        };
      },
    ],
    [
      "free growth on loss NOPAT",
      (x: ValuationInput) => {
        x.periods[0]!.reinvestment = {
          convention: "return_on_capital",
          returnOnCapital: "0.2",
        };
      },
    ],
    [
      "nonannual forecast",
      (x: ValuationInput) => {
        x.periods[0]!.periodEnd = "2025-03-31";
      },
    ],
    [
      "mature fallback",
      (x: ValuationInput) => {
        x.method = "fcff_base";
      },
    ],
    [
      "wrong engine",
      (x: ValuationInput) => {
        x.engineVersion = "fcff-1.6.0";
      },
    ],
    [
      "unsupported profile",
      (x: ValuationInput) => {
        x.assetProfile = "distressed";
      },
    ],
  ] as const)(
    "rejects %s and preserves the refusal for replay",
    (_, mutate) => {
      const input = fixtureGrowthValuation();
      mutate(input);
      const result = run(input);
      expect(result.status).toBe("rejected");
      expect(result.result).toBeNull();
      expect(replayValuationRun(result).outcome).toBe("reproduced");
    },
  );

  it.each(["NaN", "Infinity", "-Infinity"])(
    "rejects non-finite growth %s at the schema",
    (value) => {
      const input = fixtureGrowthValuation();
      input.revenueMargin!.initialRevenueGrowth = value;
      expect(valuationInputSchema.safeParse(input).success).toBe(false);
    },
  );
});
