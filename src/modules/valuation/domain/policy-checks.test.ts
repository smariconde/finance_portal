import { describe, expect, it } from "vitest";

import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { computeFcff } from "./fcff";
import {
  assertNoRejections,
  checkValuationInput,
  checkValuationOutput,
  failedChecks,
  hasValidTerminalSpread,
  TERMINAL_SPREAD_BUFFER,
} from "./policy-checks";
import { parseDecimal } from "./decimal-policy";
import { isValuationPolicyError } from "./valuation-error";
import { valuationInputSchema, type ValuationInput } from "./valuation-input";

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

function failed(input: ValuationInput, id: string) {
  return checkValuationInput(input).find((check) => check.id === id);
}

describe("valuation policy checks", () => {
  it("passes every check on the demo snapshot", () => {
    const checks = checkValuationInput(DEMO_VALUATION_INPUT);

    expect(checks.every((check) => check.status === "passed")).toBe(true);
    expect(() => assertNoRejections(checks)).not.toThrowError();
  });

  it("rejects a claim denominated in another currency", () => {
    const input = draft((candidate) => {
      candidate.bridge.debt.amount!.currency = "ARS";
    });

    expect(failed(input, "currency_and_unit_consistency")).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.debt.amount"],
    });
  });

  it("rejects a missing claim rather than reading it as zero", () => {
    const input = draft((candidate) => {
      candidate.bridge.otherClaims = {
        status: "missing",
        amount: null,
        rationale: null,
      };
    });

    expect(failed(input, "required_inputs_present")).toMatchObject({
      mode: "reject",
      status: "failed",
      subjects: ["bridge.otherClaims"],
    });
  });

  it.each(["0", "-1"])("rejects %s diluted shares", (shares) => {
    const input = draft((candidate) => {
      candidate.dilutedShares.value = shares;
    });

    expect(failed(input, "diluted_shares_positive")?.status).toBe("failed");
  });

  it("rejects a terminal wacc that does not clear growth by the buffer", () => {
    const atBuffer = draft((candidate) => {
      candidate.terminal.growth = "0.02";
      candidate.terminal.wacc = "0.025";
    });
    const overBuffer = draft((candidate) => {
      candidate.terminal.growth = "0.02";
      candidate.terminal.wacc = "0.0251";
    });

    // El borde es estricto: exactamente `g + buffer` no alcanza.
    expect(failed(atBuffer, "terminal_growth_versus_wacc")?.status).toBe(
      "failed",
    );
    expect(failed(overBuffer, "terminal_growth_versus_wacc")?.status).toBe(
      "passed",
    );
    expect(TERMINAL_SPREAD_BUFFER).toBe("0.005");
  });

  it("exposes the same spread rule the sensitivity grid uses", () => {
    expect(
      hasValidTerminalSpread(
        parseDecimal("0.03", "w"),
        parseDecimal("0.02", "g"),
      ),
    ).toBe(true);
    expect(
      hasValidTerminalSpread(
        parseDecimal("0.03", "w"),
        parseDecimal("0.03", "g"),
      ),
    ).toBe(false);
  });

  it("rejects a terminal reinvestment the growth cannot sustain", () => {
    const impossible = draft((candidate) => {
      candidate.terminal.growth = "0.10";
      candidate.terminal.wacc = "0.12";
      candidate.terminal.returnOnCapital = "0.05";
    });
    const undefinedRate = draft((candidate) => {
      candidate.terminal.returnOnCapital = "0";
    });

    // 0,10 / 0,05 = 2: reinvertir el doble del NOPAT no es un supuesto.
    expect(failed(impossible, "terminal_reinvestment_coherence")?.status).toBe(
      "failed",
    );
    // Un ROIC terminal de cero no produce Infinity: produce un rechazo.
    expect(
      failed(undefinedRate, "terminal_reinvestment_coherence")?.status,
    ).toBe("failed");
  });

  it("rejects a non positive sales-to-capital", () => {
    const input = draft((candidate) => {
      candidate.periods[2]!.reinvestment = {
        convention: "sales_to_capital",
        salesToCapital: "0",
      };
    });

    expect(failed(input, "sales_to_capital_positive")).toMatchObject({
      status: "failed",
      subjects: ["periods.2.reinvestment"],
    });
  });

  it("rejects a wacc that leaves the discount factor undefined", () => {
    const input = draft((candidate) => {
      candidate.periods[0]!.wacc = "-1";
    });

    expect(failed(input, "discount_factor_defined")).toMatchObject({
      status: "failed",
      subjects: ["periods.0.wacc"],
    });
  });

  it("rejects mixed reinvestment conventions unless a bridge is recorded", () => {
    const unbridged = draft((candidate) => {
      candidate.periods[4]!.reinvestment = {
        convention: "return_on_capital",
        returnOnCapital: "0.14",
      };
      candidate.reinvestmentConventionBridge = null;
    });
    const bridged = draft((candidate) => {
      candidate.periods[4]!.reinvestment = {
        convention: "return_on_capital",
        returnOnCapital: "0.14",
      };
      candidate.reinvestmentConventionBridge =
        "El último período pasa a growth/ROIC porque converge al estado estable.";
    });

    expect(failed(unbridged, "reinvestment_convention_bridge")?.status).toBe(
      "failed",
    );
    expect(failed(bridged, "reinvestment_convention_bridge")?.status).toBe(
      "passed",
    );
  });

  it("asks for review instead of rejecting an out of range tax rate", () => {
    const input = draft((candidate) => {
      candidate.periods[1]!.taxRate = "0.7";
    });
    const check = failed(input, "tax_rate_range");

    expect(check).toMatchObject({
      mode: "require_review",
      status: "failed",
      subjects: ["periods.1.taxRate"],
    });
    expect(() =>
      assertNoRejections(checkValuationInput(input)),
    ).not.toThrowError();
  });

  it("asks for review on a terminal margin without sector evidence", () => {
    const input = draft((candidate) => {
      candidate.terminal.ebitMargin = "0.9";
    });

    expect(failed(input, "terminal_margin_range")).toMatchObject({
      mode: "require_review",
      status: "failed",
    });
  });

  it("flags a terminal value that carries most of the answer", () => {
    const heavy = draft((candidate) => {
      candidate.terminal.growth = "0.045";
      candidate.terminal.wacc = "0.055";
    });
    const checks = checkValuationOutput(computeFcff(heavy));

    expect(
      checks.find((check) => check.id === "terminal_value_share"),
    ).toMatchObject({ mode: "require_review", status: "failed" });
  });

  it("flags a non positive equity value instead of hiding it", () => {
    const indebted = draft((candidate) => {
      candidate.bridge.debt.amount!.value = "500000000";
    });
    const checks = checkValuationOutput(computeFcff(indebted));

    expect(
      checks.find((check) => check.id === "equity_value_positive"),
    ).toMatchObject({ mode: "require_review", status: "failed" });
  });

  it("stops the run naming the failed checks and their field paths", () => {
    const input = draft((candidate) => {
      candidate.dilutedShares.value = "0";
      candidate.bridge.debt.amount!.currency = "ARS";
    });
    const checks = checkValuationInput(input);

    expect(failedChecks(checks, "reject")).toHaveLength(2);

    try {
      assertNoRejections(checks);
      throw new Error("Expected the rejections to stop the run.");
    } catch (error) {
      expect(isValuationPolicyError(error, "policy_check_failed")).toBe(true);
      expect((error as Error).message).toContain("diluted_shares_positive");
      expect((error as { subjects: string[] }).subjects).toStrictEqual([
        "bridge.debt.amount",
        "dilutedShares.value",
      ]);
    }
  });
});
