import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_VALUATION_INPUT,
  DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
} from "../infrastructure/demo-valuation-fixtures";
import {
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";
import { runValuation } from "./run-valuation";

const NOW = "2026-08-24T12:00:00.000Z";
const RUN_ID = "11111111-2222-4333-8444-555555555555";

function run(input: ValuationInput, runId: string = RUN_ID) {
  return runValuation(input, {
    now: () => NOW,
    newValuationRunId: () => runId,
  });
}

function draft(mutate: (input: ValuationInput) => void): ValuationInput {
  const candidate = structuredClone(DEMO_VALUATION_INPUT);
  mutate(candidate);

  return valuationInputSchema.parse(candidate);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runValuation", () => {
  it("computes the demo snapshot with stable hashes", () => {
    const outcome = run(DEMO_VALUATION_INPUT);

    expect(outcome).toMatchObject({
      status: "computed",
      method: "fcff_base",
      engineVersion: "fcff-1.3.0",
      methodologyVersion: "0.9.0",
      currency: "USD",
      inputHash:
        "dfaf340e216cca2e4e0f8e622dd1d479d642268aaf8b6f5dac52eb2289074e40",
      resultHash:
        "66e6ef2bc250a052a6255af255eb5ccf6788e3907353ccb8f733ab288fcc0a1d",
      failure: null,
    });
    expect(outcome.result?.valuePerShare).toBe(
      "13.54613115387460161790309586190624",
    );
    expect(outcome.decimalPolicy).toStrictEqual({
      precision: 34,
      rounding: "ROUND_HALF_EVEN",
    });
  });

  it("replays to the identical result under another run id", () => {
    const first = run(DEMO_VALUATION_INPUT, RUN_ID);
    const second = run(
      DEMO_VALUATION_INPUT,
      "99999999-8888-4777-8666-555555555555",
    );

    expect(second.inputHash).toBe(first.inputHash);
    expect(second.resultHash).toBe(first.resultHash);
    expect(second.result).toStrictEqual(first.result);
    // El identificador de corrida es lo único que cambia.
    expect(second.valuationRunId).not.toBe(first.valuationRunId);
  });

  it("answers a different knowledge cutoff with a different run", () => {
    const restated = run(DEMO_VALUATION_INPUT);
    const original = run(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT);

    expect(original.inputHash).not.toBe(restated.inputHash);
    expect(original.result?.valuePerShare).toBe(
      "14.170553285286043351982391522819",
    );
    expect(original.provenance.knowledge).toMatchObject({
      revisionPolicy: "as_known",
      knownAt: "2025-03-01T00:00:00.000Z",
    });
  });

  it("carries the provenance the result rests on", () => {
    expect(run(DEMO_VALUATION_INPUT).provenance).toMatchObject({
      sourceIds: ["fixture-demo-fundamentals"],
      // La fixture es estática: no puede fingir el UUID que una publicación
      // genera en cada corrida de ingesta.
      observationIds: [],
    });
  });

  it("records a rejection instead of throwing it away", () => {
    const outcome = run(
      draft((input) => {
        input.bridge.debt.amount!.currency = "ARS";
      }),
    );

    expect(outcome).toMatchObject({
      status: "rejected",
      result: null,
      resultHash: null,
    });
    expect(outcome.failure).toMatchObject({
      code: "policy_check_failed",
      subjects: ["bridge.debt.amount"],
    });
    expect(outcome.failure?.message).toContain("currency_and_unit_consistency");
    // El input queda igualmente registrado: una corrida rechazada también debe
    // poder explicarse (`TM-16`).
    expect(outcome.inputHash).toHaveLength(64);
  });

  it("records a terminal growth above the risk-free rate as a rejected run", () => {
    const outcome = run(
      draft((input) => {
        input.terminal.growth = "0.045";
        input.terminal.returnOnCapital = "0.12";
      }),
    );

    expect(outcome).toMatchObject({
      status: "rejected",
      result: null,
      failure: {
        code: "policy_check_failed",
        subjects: ["terminal.growth", "costOfCapital.derived.riskFree"],
      },
    });
    expect(outcome.failure?.message).toContain(
      "terminal_growth_versus_risk_free",
    );
  });

  it("rejects an unimplemented profile instead of valuing it with FCFF", () => {
    const outcome = run(
      draft((input) => {
        input.assetProfile = "bank";
      }),
    );

    expect(outcome).toMatchObject({
      status: "rejected",
      result: null,
      failure: { code: "unsupported_method", subjects: ["assetProfile"] },
    });
  });

  it("marks a computed run that still needs review", () => {
    const outcome = run(
      draft((input) => {
        input.periods[0]!.taxRate = "0.75";
      }),
    );

    expect(outcome.status).toBe("requires_review");
    expect(outcome.result?.valuePerShare).not.toBeUndefined();
    expect(
      outcome.result?.checks.filter((check) => check.status === "failed"),
    ).toStrictEqual([
      expect.objectContaining({
        id: "tax_rate_range",
        mode: "require_review",
        subjects: ["periods.0.taxRate"],
      }),
    ]);
  });

  it("keeps the failure message free of received values", () => {
    const outcome = run(
      draft((input) => {
        input.dilutedShares.value = "0";
      }),
    );

    expect(outcome.failure?.message).not.toContain("0");
    expect(outcome.failure?.subjects).toStrictEqual(["dilutedShares.value"]);
  });

  it("does not open the network to recompute", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    run(DEMO_VALUATION_INPUT);
    run(DEMO_VALUATION_INPUT_BEFORE_AMENDMENT);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not read the clock on its own", () => {
    const outcome = run(DEMO_VALUATION_INPUT);

    expect(outcome.startedAt).toBe(NOW);
    expect(outcome.finishedAt).toBe(NOW);
    expect(outcome.recordedAt).toBe(NOW);
  });
});
