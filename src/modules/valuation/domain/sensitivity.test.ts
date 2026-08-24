import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { parseDecimal } from "./decimal-policy";
import { computeFcff } from "./fcff";
import {
  buildSensitivityGrid,
  MAX_SENSITIVITY_AXIS_POINTS,
} from "./sensitivity";
import { isValuationPolicyError } from "./valuation-error";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

function expectPolicyFailure(operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected a valuation policy failure.");
  } catch (error) {
    expect(isValuationPolicyError(error, "policy_check_failed")).toBe(true);
  }
}

describe("WACC and terminal growth sensitivity", () => {
  const grid = buildSensitivityGrid(DEMO_VALUATION_INPUT);

  it("declares unit, currency, range and step of both axes", () => {
    expect(grid).toMatchObject({
      unit: "value_per_share",
      currency: "USD",
      wacc: { from: "0.03", to: "0.11", step: "0.02" },
      terminalGrowth: { from: "0", to: "0.04", step: "0.01" },
    });
    expect(grid.wacc.values).toStrictEqual([
      "0.03",
      "0.05",
      "0.07",
      "0.09",
      "0.11",
    ]);
    expect(grid.terminalGrowth.values).toStrictEqual([
      "0",
      "0.01",
      "0.02",
      "0.03",
      "0.04",
    ]);
  });

  it("marks the cells where the model is not defined instead of blanking them", () => {
    const cheapest = grid.rows[0]!;

    // WACC 0,03 no supera a `g + 0,005` para g de 0,03 ni de 0,04.
    expect(cheapest.cells.map((cell) => cell.status)).toStrictEqual([
      "computed",
      "computed",
      "computed",
      "rejected",
      "rejected",
    ]);
    expect(cheapest.cells[3]).toStrictEqual({
      status: "rejected",
      reason: "terminal_growth_versus_wacc",
    });
  });

  it("contains the base case as one of its own cells", () => {
    // El snapshot demo usa un costo de capital plano justamente para que la
    // tabla no contradiga al número principal.
    const baseCell = grid.rows[3]!.cells[2]!;

    expect(grid.rows[3]!.wacc).toBe("0.09");
    expect(grid.terminalGrowth.values[2]).toBe("0.02");
    expect(baseCell).toStrictEqual({
      status: "computed",
      valuePerShare: computeFcff(DEMO_VALUATION_INPUT).valuePerShare,
    });
  });

  it("decreases along the cost of capital and increases along growth", () => {
    const column = grid.rows.map((row) => {
      const cell = row.cells[0]!;

      return cell.status === "computed"
        ? parseDecimal(cell.valuePerShare, "cell")
        : null;
    });

    for (let index = 1; index < column.length; index += 1) {
      expect(column[index]!.lt(column[index - 1]!)).toBe(true);
    }

    const row = grid.rows[4]!.cells.map((cell) =>
      cell.status === "computed"
        ? parseDecimal(cell.valuePerShare, "cell")
        : null,
    );

    for (let index = 1; index < row.length; index += 1) {
      expect(row[index]!.gt(row[index - 1]!)).toBe(true);
    }
  });

  it("holds every other assumption constant", () => {
    // Sólo cambian WACC y `g`: el flujo del primer período es el mismo que en
    // el caso base porque no depende de ninguno de los dos.
    const base = computeFcff(DEMO_VALUATION_INPUT);
    const shocked = computeFcff(DEMO_VALUATION_INPUT, {
      wacc: "0.11",
      terminalGrowth: "0.01",
    });

    expect(shocked.periods[0]?.fcff).toBe(base.periods[0]?.fcff);
    expect(shocked.periods[0]?.discountFactor).toBe("1.11");
  });

  it("refuses an axis that cannot be walked", () => {
    expectPolicyFailure(() =>
      buildSensitivityGrid(
        draft((candidate) => {
          candidate.sensitivity!.wacc.step = "0";
        }),
      ),
    );
    expectPolicyFailure(() =>
      buildSensitivityGrid(
        draft((candidate) => {
          candidate.sensitivity!.wacc.from = "0.12";
          candidate.sensitivity!.wacc.to = "0.04";
        }),
      ),
    );
  });

  it("caps the grid instead of expanding an unbounded axis", () => {
    expect(MAX_SENSITIVITY_AXIS_POINTS).toBe(11);
    expectPolicyFailure(() =>
      buildSensitivityGrid(
        draft((candidate) => {
          candidate.sensitivity!.wacc.from = "0.01";
          candidate.sensitivity!.wacc.to = "0.5";
          candidate.sensitivity!.wacc.step = "0.001";
        }),
      ),
    );
  });

  it("refuses to invent a grid the snapshot never declared", () => {
    expectPolicyFailure(() =>
      buildSensitivityGrid(
        draft((candidate) => {
          candidate.sensitivity = null;
        }),
      ),
    );
  });
});
