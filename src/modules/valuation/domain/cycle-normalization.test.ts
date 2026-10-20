import { describe, expect, it } from "vitest";
import { replayValuationRun } from "../application/replay-valuation-run";
import { runValuation } from "../application/run-valuation";
import { fixtureCycleValuation } from "../infrastructure/fixture-cycle-valuation";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { deriveCycleNormalization } from "./cycle-normalization";
import { computeFcff } from "./fcff";
import { formatDecimal, parseDecimal } from "./decimal-policy";
import { PROFILE_PRECEDENCE, selectValuationMethod } from "./method-selection";
import { SCENARIO_SET_VERSION } from "./scenarios";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

const deps = {
  now: () => "2025-07-01T00:00:00.000Z",
  newValuationRunId: () => "11111111-1111-4111-8111-111111111111",
};
const run = (input = fixtureCycleValuation()) => runValuation(input, deps);
const derive = (input: ValuationInput) =>
  deriveCycleNormalization(
    input.cycleNormalization!,
    input.baseRevenue.value,
    input.normalization.base.ebitAdjusted,
    input.periods.length,
  );

describe("normalized FCFF cycle contract", () => {
  it.each(["cyclical", "commodity"] as const)(
    "admits %s with its own method and a frozen replay",
    (profile) => {
      const result = run(fixtureCycleValuation(profile));
      expect(result.status).toBe("requires_review");
      expect(result.method).toBe("normalized_fcff");
      expect(result.input.assessment.rigor.level).toBe("screening");
      expect(result.result?.cycleComparison?.historicalMargin).toBe("0.106");
      expect(result.result?.cycleComparison?.annualMargins).toEqual([
        "0.1",
        "0.2",
        "-0.1",
        "0.15",
        "0.18",
      ]);
      expect(result.provenance.sourceIds).toContain("fixture-cycle");
      expect(replayValuationRun(result).outcome).toBe("reproduced");
    },
  );

  it("averages yearly ratios equally, retains losses and scales to current size", () => {
    const input = fixtureCycleValuation();
    const cycle = derive(input);
    expect(cycle.normalizedBaseEbit).toBe("10176000");
    expect(cycle.periodMargins[2]).toBe("0.106");
    expect(cycle.periodMargins[4]).toBe("0.106");
    const scaled = structuredClone(input);
    scaled.cycleNormalization!.history.forEach((year) => {
      year.ebit!.value = formatDecimal(
        parseDecimal(year.ebit!.value, "ebit").times(7),
        "ebit",
      );
      year.revenue!.value = formatDecimal(
        parseDecimal(year.revenue!.value, "sales").times(7),
        "sales",
      );
    });
    expect(derive(scaled).historicalMargin).toBe(cycle.historicalMargin);
  });

  it("reports the current-margin counterfactual with the same bridge and reinvestment", () => {
    const input = fixtureCycleValuation();
    const result = run(input).result!;
    const current = computeFcff(input, { ebitMargin: "0.18" });
    expect(result.cycleComparison!.currentMarginValuePerShare).toBe(
      current.valuePerShare,
    );
    expect(Number(result.valuePerShare)).toBeLessThan(
      Number(current.valuePerShare),
    );
  });

  it("preserves negative projected EBIT without inventing an immediate tax credit", () => {
    const input = fixtureCycleValuation();
    input.periods[0]!.ebitMargin = "-0.1";
    const result = computeFcff(input);
    expect(result.periods[0]!.ebit).toBe("-10368000");
    expect(result.periods[0]!.nopat).toBe("-10368000");
    // Direct kernel test; the public run still requires a traced cycle path.
    expect(run(input).status).toBe("rejected");
  });

  it("keeps normalized sensitivity on the same case base and rejects growth above the risk-free ceiling", () => {
    const input = fixtureCycleValuation();
    input.sensitivity!.terminalGrowth = {
      from: "0.01",
      to: "0.06",
      step: "0.005",
    };
    const result = run(input).result!;
    const grid = result.sensitivity!;
    const row = grid.rows.find((entry) => entry.wacc === input.terminal.wacc)!;
    const column = grid.terminalGrowth.values.indexOf(input.terminal.growth);
    expect(row.cells[column]).toEqual({
      status: "computed",
      valuePerShare: result.valuePerShare,
    });
    expect(
      grid.rows.every((entry) =>
        entry.cells.some((cell) => cell.status === "rejected"),
      ),
    ).toBe(true);
  });

  it.each(["0.005", "0.02", "0.06"])(
    "a higher normalized target %s increases value with sales and financing fixed",
    (shift) => {
      const input = fixtureCycleValuation();
      const base = run(input).result!;
      input.cycleNormalization!.marginShift = {
        value: shift,
        rationale: "Explicit efficiency stress",
      };
      const changed = derive(input);
      input.periods.forEach((period, index) => {
        period.ebitMargin = changed.periodMargins[index]!;
      });
      input.terminal.ebitMargin = changed.targetMargin;
      const result = run(input);
      expect(result.status).toBe("requires_review");
      expect(Number(result.result!.valuePerShare)).toBeGreaterThan(
        Number(base.valuePerShare),
      );
    },
  );

  it("rebuilds the complete convergence path for each scenario target", () => {
    const input = fixtureCycleValuation();
    input.scenarios = {
      version: SCENARIO_SET_VERSION,
      bear: {
        thesis: "Structurally lower margin",
        drivers: [
          {
            driver: "terminalEbitMargin",
            value: "0.08",
            rationale: "Higher costs through the next cycle",
          },
        ],
      },
      bull: {
        thesis: "Operating efficiency",
        drivers: [
          {
            driver: "terminalEbitMargin",
            value: "0.14",
            rationale: "Lower costs through the next cycle",
          },
        ],
      },
    };
    const result = run(input);
    expect(result.status).toBe("requires_review");
    expect(result.result?.scenarios?.bear.periods[0]?.ebit).not.toBe(
      result.result?.periods[0]?.ebit,
    );
    expect(Number(result.result?.scenarios?.bear.valuePerShare)).toBeLessThan(
      Number(result.result?.valuePerShare),
    );
    expect(
      Number(result.result?.scenarios?.bull.valuePerShare),
    ).toBeGreaterThan(Number(result.result?.valuePerShare));
    input.scenarios.bear.drivers = [
      { driver: "terminalGrowth", value: "0.9", rationale: "Invalid stress" },
    ];
    expect(
      run(input).failure?.subjects.some((path) =>
        path.startsWith("scenarios.bear:"),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "missing history",
      (x: ValuationInput) => {
        x.cycleNormalization!.history = [];
      },
    ],
    [
      "missing EBIT",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.ebit = null;
      },
    ],
    [
      "missing revenue",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.revenue = null;
      },
    ],
    [
      "late employee note",
      (x: ValuationInput) => {
        x.cycleNormalization!.employeeEquityAvailableAt =
          "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "late rate",
      (x: ValuationInput) => {
        x.costOfCapital.parameters[0]!.availableAt = "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "another entity",
      (x: ValuationInput) => {
        x.cycleNormalization!.profileEvidence[0]!.legalEntityId =
          "22222222-2222-4222-8222-222222222222";
      },
    ],
    [
      "zero revenue",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.revenue!.value = "0";
      },
    ],
    [
      "negative revenue",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.revenue!.value = "-1";
      },
    ],
    [
      "currency mismatch",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.ebit!.currency = "ARS";
      },
    ],
    [
      "late filing",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.ebit!.availableAt =
          "2025-07-01T00:00:00.000Z";
      },
    ],
    [
      "missing provenance",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[0]!.ebit!.sourceDocumentId = null;
      },
    ],
    [
      "duplicate year",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[1] = structuredClone(
          x.cycleNormalization!.history[0]!,
        );
      },
    ],
    [
      "gap",
      (x: ValuationInput) => {
        x.cycleNormalization!.history[1]!.fiscalYearEnd = "2019-12-31";
      },
    ],
    [
      "wrong base",
      (x: ValuationInput) => {
        x.cycleNormalization!.history.at(-1)!.ebit!.value = "1";
      },
    ],
    [
      "untraced margin",
      (x: ValuationInput) => {
        x.periods[0]!.ebitMargin = "0.9";
      },
    ],
    [
      "untraced terminal",
      (x: ValuationInput) => {
        x.terminal.ebitMargin = "0.9";
      },
    ],
    [
      "wrong engine",
      (x: ValuationInput) => {
        x.engineVersion = "fcff-1.6.0";
      },
    ],
    [
      "incomplete convergence",
      (x: ValuationInput) => {
        x.cycleNormalization!.convergenceYears = 20;
      },
    ],
    [
      "recorded knowledge",
      (x: ValuationInput) => {
        x.knowledge = {
          ...x.knowledge,
          revisionPolicy: "as_known",
          knownAt: x.knowledge.knownAt!,
          knowledgeBasis: "system_recorded",
        };
      },
    ],
    [
      "nonpositive normalized margin",
      (x: ValuationInput) => {
        x.cycleNormalization!.history.forEach((y) => {
          y.ebit!.value = "-1";
        });
      },
    ],
    [
      "unsupported classification",
      (x: ValuationInput) => {
        x.cycleNormalization!.profileEvidence.forEach((e) => {
          e.present = e.profile === "holding";
        });
      },
    ],
    [
      "future classification",
      (x: ValuationInput) => {
        x.cycleNormalization!.profileEvidence.forEach((e) => {
          e.availableAt = "2025-07-01T00:00:00.000Z";
        });
      },
    ],
  ])("rejects %s with an auditable refusal", (_, change) => {
    const input = fixtureCycleValuation();
    (change as (x: ValuationInput) => void)(input);
    const result = run(input);
    expect(result.status).toBe("rejected");
    expect(result.result).toBeNull();
    expect(replayValuationRun(result).outcome).toBe("reproduced");
  });

  it.each(["NaN", "Infinity", "-Infinity"])(
    "rejects nonfinite history %s at the schema",
    (value) => {
      const input = fixtureCycleValuation();
      input.cycleNormalization!.history[0]!.ebit!.value = value;
      expect(valuationInputSchema.safeParse(input).success).toBe(false);
    },
  );

  it("names the cycle snapshot missing and never admits it from FCFF completeness alone", () => {
    const input = fixtureCycleValuation();
    const result = selectValuationMethod({
      legalEntityId: input.subject.legalEntityId,
      knowledge: input.knowledge,
      evidence: input.cycleNormalization!.profileEvidence,
      fcffInputsComplete: true,
    });
    expect(result).toMatchObject({
      status: "unsupported_method",
      unsupportedReasons: ["missing_required_input"],
      requiredInputs: ["cycle_margins"],
    });
    expect(PROFILE_PRECEDENCE.flat().length).toBeGreaterThan(1);
    expect(
      run({ ...DEMO_VALUATION_INPUT, assetProfile: "commodity" }).failure?.code,
    ).toBe("unsupported_method");
  });
});
