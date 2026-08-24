import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { parseDecimal } from "./decimal-policy";
import { computeFcff } from "./fcff";
import { isValuationPolicyError } from "./valuation-error";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

describe("FCFF base engine", () => {
  const base = computeFcff(DEMO_VALUATION_INPUT);

  it("projects revenue, NOPAT and reinvestment period by period", () => {
    // Golden calculado aparte: 96.000.000 * 1,08 = 103.680.000; EBIT al 18% es
    // 18.662.400; NOPAT al 25% de impuestos es 13.996.800; la reinversión es
    // 7.680.000 / 2,5 = 3.072.000.
    expect(base.periods[0]).toMatchObject({
      periodIndex: 1,
      revenue: "103680000",
      revenueChange: "7680000",
      ebit: "18662400",
      nopat: "13996800",
      reinvestment: "3072000",
      fcff: "10924800",
      discountFactor: "1.09",
      presentValue: "10022752.29357798165137614678899083",
    });
  });

  it("compounds the discount factor instead of raising an average rate", () => {
    expect(base.periods.map((period) => period.discountFactor)).toStrictEqual([
      "1.09",
      "1.1881",
      "1.295029",
      "1.41158161",
      "1.5386239549",
    ]);
  });

  it("builds the terminal value from a reinvestment rate the growth sustains", () => {
    // 0,02 / 0,12 = 0,1666… y el terminal descuenta con el factor del último
    // período explícito, no con uno propio.
    expect(base.terminal).toMatchObject({
      reinvestmentRate: "0.1666666666666666666666666666666667",
      fcff: "14735333.313792",
      terminalValue: "210504761.6256",
      discountFactor: "1.5386239549",
      presentValue: "136813651.5457289660842261464780214",
    });
  });

  it("bridges enterprise value to equity and to a per share value", () => {
    expect(base).toMatchObject({
      enterpriseValue: "187326639.423432520223788698273828",
      equityValue: "169326639.423432520223788698273828",
      dilutedShares: "12500000",
      valuePerShare: "13.54613115387460161790309586190624",
      terminalValueShare: "0.7303480805870639556002439680545067",
    });
  });

  it("records a declared absence as an explicit zero with its rationale", () => {
    const absent = base.bridgeComponents.find(
      (component) => component.key === "minorityInterest",
    );

    expect(absent).toMatchObject({ status: "declared_absent", value: "0" });
    expect(absent?.rationale).not.toBeNull();
  });

  it("refuses to value a missing claim as zero", () => {
    const input = draft((candidate) => {
      candidate.bridge.debt = {
        status: "missing",
        amount: null,
        rationale: null,
      };
    });

    expect(() => computeFcff(input)).toThrowError();
    try {
      computeFcff(input);
    } catch (error) {
      expect(isValuationPolicyError(error, "policy_check_failed")).toBe(true);
      expect((error as { subjects: string[] }).subjects).toStrictEqual([
        "bridge.debt",
      ]);
    }
  });

  it("treats zero growth as zero reinvestment, not as a missing period", () => {
    const input = draft((candidate) => {
      for (const period of candidate.periods) {
        period.revenueGrowth = "0";
      }
    });
    const computation = computeFcff(input);

    expect(computation.periods[0]).toMatchObject({
      revenue: "96000000",
      revenueChange: "0",
      reinvestment: "0",
      // Sin crecimiento el FCFF es exactamente el NOPAT.
      nopat: "12960000",
      fcff: "12960000",
    });
  });

  it("carries a negative margin through to a negative flow", () => {
    const input = draft((candidate) => {
      for (const period of candidate.periods) {
        period.ebitMargin = "-0.05";
      }
    });
    const computation = computeFcff(input);

    expect(computation.periods[0]).toMatchObject({
      ebit: "-5184000",
      nopat: "-3888000",
      fcff: "-6960000",
    });
    expect(computation.periods[0]?.presentValue.startsWith("-")).toBe(true);
  });

  it("supports the growth over ROIC convention and reports its rate", () => {
    const input = draft((candidate) => {
      for (const period of candidate.periods) {
        period.reinvestment = {
          convention: "return_on_capital",
          returnOnCapital: "0.16",
        };
      }
      candidate.reinvestmentConventionBridge = null;
    });
    const computation = computeFcff(input);

    // 0,08 / 0,16 = 0,5 y la reinversión es la mitad del NOPAT.
    expect(computation.periods[0]).toMatchObject({
      reinvestmentConvention: "return_on_capital",
      reinvestmentRate: "0.5",
      nopat: "13996800",
      reinvestment: "6998400",
      fcff: "6998400",
    });
  });

  it("rejects a zero sales-to-capital instead of returning Infinity", () => {
    const input = draft((candidate) => {
      candidate.periods[0]!.reinvestment = {
        convention: "sales_to_capital",
        salesToCapital: "0",
      };
    });

    try {
      computeFcff(input);
      throw new Error("Expected a division by zero policy failure.");
    } catch (error) {
      expect(isValuationPolicyError(error, "division_by_zero")).toBe(true);
    }
  });

  it("rejects a zero return on capital under the growth over ROIC convention", () => {
    const input = draft((candidate) => {
      candidate.periods[0]!.reinvestment = {
        convention: "return_on_capital",
        returnOnCapital: "0",
      };
      candidate.reinvestmentConventionBridge = "Puente declarado para el test.";
    });

    try {
      computeFcff(input);
      throw new Error("Expected a division by zero policy failure.");
    } catch (error) {
      expect(isValuationPolicyError(error, "division_by_zero")).toBe(true);
    }
  });

  it("keeps a higher cost of capital from raising the value", () => {
    const cheaper = computeFcff(DEMO_VALUATION_INPUT, { wacc: "0.08" });
    const dearer = computeFcff(DEMO_VALUATION_INPUT, { wacc: "0.10" });

    expect(
      parseDecimal(dearer.valuePerShare, "value").lt(
        parseDecimal(cheaper.valuePerShare, "value"),
      ),
    ).toBe(true);
  });

  it("keeps more debt from raising equity value with enterprise value fixed", () => {
    const heavier = computeFcff(
      draft((candidate) => {
        candidate.bridge.debt.amount!.value = "60000000";
      }),
    );

    expect(heavier.enterpriseValue).toBe(base.enterpriseValue);
    expect(
      parseDecimal(heavier.equityValue, "equity").lt(
        parseDecimal(base.equityValue, "equity"),
      ),
    ).toBe(true);
  });

  it("is a pure function of its snapshot", () => {
    expect(computeFcff(DEMO_VALUATION_INPUT)).toStrictEqual(base);
  });
});
