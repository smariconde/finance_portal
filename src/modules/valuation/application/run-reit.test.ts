import { describe, expect, it } from "vitest";

import { deriveEmployeeEquity } from "../domain/employee-equity-claim";
import { selectValuationMethod } from "../domain/method-selection";
import { reitInputSchema, type ReitInput } from "../domain/reit-input";
import { reitRunSchema } from "../domain/reit-run";
import { fixtureReitValuation } from "../infrastructure/fixture-reit-valuation";
import { DEMO_VALUATION_INPUT } from "../infrastructure/demo-valuation-fixtures";
import { parseDecimal } from "../domain/decimal-policy";
import { createInMemoryValuationRunRepository } from "../infrastructure/in-memory-valuation-run-repository";
import { replayValuationRun } from "./replay-valuation-run";
import { runReit } from "./run-reit";
import { toReplayKey } from "./valuation-run-repository";

const dependencies = {
  now: () => "2026-10-20T15:00:00.000Z",
  newValuationRunId: () => "11111111-2222-4333-8444-555555555555",
};
const run = (input = fixtureReitValuation()) => runReit(input, dependencies);
const reasons = (input: ReitInput) => {
  const result = run(input);
  expect(result.status).toBe("rejected");
  expect(result.result).toBeNull();
  expect(replayValuationRun(result).outcome).toBe("reproduced");
  return result.failure!.subjects;
};

describe("property REIT AFFO and NAV", () => {
  it("reconciles common cash, funds growth and keeps the two equity valuations separate", () => {
    const result = run();
    expect(result.status).toBe("requires_review");
    expect(result.result).toMatchObject({
      modelStatus: "experimental",
      rigor: "screening",
      base: {
        reconciliation: {
          commonNetIncome: "8",
          ffo: "13",
          affo: "10",
          recurringCapex: "2",
          straightLineRent: "1",
        },
        nav: {
          propertyValue: "250",
          grossCommonEquity: "180",
          equityValue: "180",
          valuePerShare: "18",
        },
        shareCount: "10",
        employeeOptionValue: "0",
      },
    });
    const base = result.result!.base;
    expect(Number(base.periods[0]!.retention)).toBeCloseTo(0.02 / 0.12, 14);
    expect(Number(base.periods[0]!.distributableCash)).toBeCloseTo(8.5, 12);
    expect(result.result!.scenarios!.bear.periods).not.toEqual(base.periods);
    expect(Number(result.result!.scenarios!.bear.valuePerShare)).toBeLessThan(
      Number(base.valuePerShare),
    );
    expect(
      Number(result.result!.scenarios!.bull.valuePerShare),
    ).toBeGreaterThan(Number(base.valuePerShare));
    expect(result.result!.sensitivity!.rows[1]!.cells[1]).toEqual({
      status: "computed",
      valuePerShare: base.valuePerShare,
    });
    expect(result.result!.sensitivity!.rows[1]!.cells[2]).toMatchObject({
      status: "rejected",
      reasons: ["reit_terminal_growth"],
    });
    expect(result.result!.navSensitivity![1]).toMatchObject({
      status: "computed",
      valuePerShare: "18",
    });
    expect(result.result!.navSensitivity![3]).toMatchObject({
      status: "rejected",
      valuePerShare: null,
      reasons: ["reit_nav_capitalization"],
    });
  });

  it("does not subtract financing twice from common cash; NAV alone responds to a debt claim", () => {
    const input = fixtureReitValuation();
    const original = run(input).result!.base;
    input.nav.debt!.value = "90";
    const changed = run(input).result!.base;
    expect(changed.valuePerShare).toBe(original.valuePerShare);
    expect(Number(changed.nav.valuePerShare)).toBe(
      Number(original.nav.valuePerShare) - 2,
    );
    input.nav.debt!.value = "1000";
    const underwater = run(input);
    expect(Number(underwater.result!.base.nav.valuePerShare)).toBeLessThan(0);
    expect(underwater.result!.checks).toContainEqual(
      expect.objectContaining({ id: "reit_nav_nonpositive", status: "failed" }),
    );
  });

  it("preserves signed gains, losses and negative straight-line adjustments", () => {
    const input = fixtureReitValuation();
    input.affo.propertySaleGains!.value = "-2";
    input.affo.jointVentureAdjustment!.value = "-1";
    input.affo.straightLineRent!.value = "-1";
    expect(run(input).result!.base.reconciliation).toMatchObject({
      ffo: "16",
      affo: "15",
    });
  });

  it.each([
    [
      "missing AFFO",
      (i: ReitInput) => {
        i.affo.recurringCapex = null;
      },
      "affo.recurringCapex",
    ],
    [
      "missing NAV",
      (i: ReitInput) => {
        i.nav.debt = null;
      },
      "nav.debt",
    ],
    [
      "missing risk",
      (i: ReitInput) => {
        i.risk.riskFree = null;
      },
      "risk.riskFree",
    ],
    [
      "missing shares",
      (i: ReitInput) => {
        i.employeeEquity = null;
      },
      "employeeEquity",
    ],
    [
      "missing note availability",
      (i: ReitInput) => {
        i.employeeEquityAvailableAt = null;
      },
      "employeeEquityAvailableAt",
    ],
    [
      "missing NAV availability",
      (i: ReitInput) => {
        i.nav.availableAt = null;
      },
      "nav.availableAt",
    ],
    [
      "currency mismatch",
      (i: ReitInput) => {
        i.affo.commonNetIncome!.currency = "EUR";
      },
      "affo.commonNetIncome",
    ],
    [
      "risk currency mismatch",
      (i: ReitInput) => {
        i.risk.matureErp!.currency = "EUR";
      },
      "risk.matureErp",
    ],
    [
      "negative expense",
      (i: ReitInput) => {
        i.affo.recurringCapex!.value = "-1";
      },
      "affo.recurringCapex",
    ],
    [
      "negative claim",
      (i: ReitInput) => {
        i.nav.debt!.value = "-1";
      },
      "nav.debt",
    ],
    [
      "zero AFFO",
      (i: ReitInput) => {
        i.affo.recurringCapex!.value = "12";
      },
      "affo",
    ],
    [
      "negative AFFO",
      (i: ReitInput) => {
        i.affo.recurringCapex!.value = "13";
      },
      "affo",
    ],
    [
      "zero shares",
      (i: ReitInput) => {
        i.employeeEquity!.sharesOutstanding.value = "0";
      },
      "employeeEquity.sharesOutstanding.value",
    ],
    [
      "mortgage REIT",
      (i: ReitInput) => {
        i.propertyBasis = "mortgage";
      },
      "propertyBasis",
    ],
    [
      "hybrid REIT",
      (i: ReitInput) => {
        i.propertyBasis = "hybrid";
      },
      "propertyBasis",
    ],
    [
      "future AFFO",
      (i: ReitInput) => {
        i.affo.commonNetIncome!.availableAt = "2026-01-01T00:00:00.000Z";
      },
      "affo.commonNetIncome",
    ],
    [
      "future NAV evidence",
      (i: ReitInput) => {
        i.nav.availableAt = "2026-01-01T00:00:00.000Z";
      },
      "nav.availableAt",
    ],
    [
      "future note",
      (i: ReitInput) => {
        i.employeeEquityAvailableAt = "2026-01-01T00:00:00.000Z";
      },
      "employeeEquityAvailableAt",
    ],
    [
      "unaligned NAV",
      (i: ReitInput) => {
        i.nav.debt!.asOf = "2024-12-31";
      },
      "nav.debt",
    ],
    [
      "unaligned AFFO",
      (i: ReitInput) => {
        i.affo.recurringCapex!.asOf = "2024-12-30";
      },
      "affo.recurringCapex",
    ],
    [
      "nonannual AFFO",
      (i: ReitInput) => {
        i.affo.periodStart = "2024-10-01";
      },
      "affo.period",
    ],
    [
      "stale AFFO",
      (i: ReitInput) => {
        i.affo.periodStart = "2023-01-01";
        i.affo.periodEnd = "2023-12-31";
      },
      "affo.period",
    ],
    [
      "system recorded",
      (i: ReitInput) => {
        i.knowledge.knowledgeBasis = "system_recorded";
      },
      "knowledge.knowledgeBasis",
    ],
    [
      "effective cutoff",
      (i: ReitInput) => {
        i.knowledge.effectiveAt = "2025-07-01T00:00:00.000Z";
      },
      "knowledge.effectiveAt",
    ],
    [
      "future classification",
      (i: ReitInput) => {
        i.profileEvidence[0]!.availableAt = "2026-01-01T00:00:00.000Z";
      },
      "profileEvidence",
    ],
    [
      "classification conflict",
      (i: ReitInput) => {
        i.profileEvidence.push({ ...i.profileEvidence[0]!, profile: "bank" });
      },
      "profileEvidence",
    ],
    [
      "zero incremental return",
      (i: ReitInput) => {
        i.assumptions.periods[0]!.returnOnNewEquity = "0";
      },
      "assumptions.periods.0",
    ],
    [
      "unfunded growth",
      (i: ReitInput) => {
        i.assumptions.periods[1]!.affoGrowth = "0.2";
      },
      "assumptions.periods.0",
    ],
    [
      "negative growth",
      (i: ReitInput) => {
        i.assumptions.periods[0]!.affoGrowth = "-0.1";
      },
      "assumptions.periods.0",
    ],
    [
      "terminal free growth",
      (i: ReitInput) => {
        i.assumptions.terminal.returnOnNewEquity = "0";
      },
      "assumptions.terminal",
    ],
    [
      "terminal ceiling",
      (i: ReitInput) => {
        i.assumptions.terminal.growth = "0.031";
      },
      "assumptions.terminal",
    ],
    [
      "terminal buffer",
      (i: ReitInput) => {
        i.assumptions.terminal.equityBeta = "0";
        i.assumptions.terminal.growth = "0.03";
      },
      "assumptions.terminal",
    ],
    [
      "zero cap rate",
      (i: ReitInput) => {
        i.assumptions.nav.capRate = "0";
      },
      "assumptions.nav",
    ],
    [
      "negative cap rate",
      (i: ReitInput) => {
        i.assumptions.nav.capRate = "-0.01";
      },
      "assumptions.nav",
    ],
    [
      "nonpositive NOI",
      (i: ReitInput) => {
        i.assumptions.nav.forwardNoi = "0";
      },
      "assumptions.nav",
    ],
    [
      "bad scenario",
      (i: ReitInput) => {
        i.scenarios!.bear.terminal.growth = "0.2";
      },
      "scenarios.bear.terminal",
    ],
    [
      "label-only scenario",
      (i: ReitInput) => {
        i.scenarios!.bear = structuredClone(i.assumptions);
      },
      "scenarios.bear",
    ],
    [
      "scenario horizon",
      (i: ReitInput) => {
        i.scenarios!.bull.periods.pop();
      },
      "scenarios.bull",
    ],
  ] as const)(
    "refuses %s with the field named and reproducible rejection",
    (_name, mutate, subject) => {
      const input = fixtureReitValuation();
      mutate(input);
      expect(reasons(input)).toContain(subject);
    },
  );

  it("accepts explicit zeros, exact cutoff and maximum annual horizons", () => {
    const input = fixtureReitValuation();
    input.scenarios = null;
    input.sensitivity = null;
    input.affo.recurringCapex!.value = "0";
    input.nav.debt!.value = "0";
    input.nav.availableAt = input.knowledge.knownAt;
    input.employeeEquityAvailableAt = input.knowledge.knownAt;
    input.assumptions.periods = Array.from({ length: 20 }, () => ({
      ...input.assumptions.periods[0]!,
    }));
    expect(run(input).result!.base.periods).toHaveLength(20);
    const selection = selectValuationMethod({
      legalEntityId: input.subject.legalEntityId,
      knowledge: input.knowledge,
      evidence: input.profileEvidence,
      fcffInputsComplete: true,
    });
    expect(selection).toMatchObject({
      version: "method-selection-0.6.0",
      status: "unsupported_method",
      requiredInputs: ["affo", "nav"],
    });
    expect(
      selectValuationMethod({
        legalEntityId: input.subject.legalEntityId,
        knowledge: input.knowledge,
        evidence: input.profileEvidence,
        fcffInputsComplete: false,
        reitMissingInputs: [],
      }).status,
    ).toBe("selected");
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e1000"])(
    "rejects noncanonical or nonfinite input %s at the schema boundary",
    (value) => {
      const input = fixtureReitValuation();
      input.affo.commonNetIncome!.value = value;
      expect(() => run(input)).toThrow();
    },
  );

  it("rejects an unknown engine version and null required assumption", () => {
    expect(
      reitInputSchema.safeParse({
        ...fixtureReitValuation(),
        engineVersion: "future-1.0.0",
      }).success,
    ).toBe(false);
    expect(
      reitInputSchema.safeParse({
        ...fixtureReitValuation(),
        assumptions: null,
      }).success,
    ).toBe(false);
  });

  it("recomputes employee units and options once for both valuations", () => {
    const input = fixtureReitValuation();
    const claim = input.employeeEquity!;
    claim.decision.transcription.unitsStatus = "outstanding";
    claim.decision.transcription.units = [
      { kind: "restricted", count: "2", quote: "2 synthetic RSUs" },
    ];
    // Use the existing task contract for options and its independent pricing tests.
    claim.derived = deriveEmployeeEquity({
      ...claim,
      riskFree: input.risk.riskFree!.value,
    });
    const computed = run(input);
    expect(computed.result!.base.shareCount).toBe("12");
    expect(computed.result!.base.nav.valuePerShare).toBe("15");
    claim.derived.shareCount = "10";
    expect(reasons(input)).toContain("employeeEquity.derived");
  });

  it("records exact decimals, deduplicates, replays and detects tampered results", async () => {
    const repository = createInMemoryValuationRunRepository();
    const computed = run();
    const stored = await repository.record(
      JSON.parse(JSON.stringify(computed)),
    );
    expect(stored).toEqual(computed);
    expect(
      (
        await repository.record({
          ...computed,
          valuationRunId: "99999999-8888-4777-8666-555555555555",
        })
      ).valuationRunId,
    ).toBe(computed.valuationRunId);
    expect(await repository.findByReplayKey(toReplayKey(stored))).toEqual(
      stored,
    );
    expect(replayValuationRun(stored).outcome).toBe("reproduced");
    const tampered = structuredClone(computed);
    tampered.result!.base.nav.valuePerShare = "999";
    expect(replayValuationRun(tampered).divergences).toContain("result_hash");
    const modified = structuredClone(computed);
    modified.input.nav.debt!.value = "90";
    expect(replayValuationRun(modified).divergences).toContain("input_hash");
    expect(
      reitRunSchema.safeParse({ ...computed, currency: "EUR" }).success,
    ).toBe(false);
  });

  it("subtracts outstanding options once from each gross equity without adding options to shares", () => {
    const input = fixtureReitValuation();
    const original = run(input).result!.base;
    const claim = structuredClone(DEMO_VALUATION_INPUT.employeeEquity);
    claim.sharesOutstanding.value = "10";
    claim.decision.transcription.scale = "units";
    claim.decision.transcription.optionsCount = "1";
    claim.decision.transcription.unitsStatus = "none_disclosed";
    claim.decision.transcription.units = [];
    claim.derived = deriveEmployeeEquity({
      ...claim,
      riskFree: input.risk.riskFree!.value,
    });
    input.employeeEquity = claim;
    const actual = run(input).result!.base;
    expect(actual.shareCount).toBe("10");
    expect(Number(actual.employeeOptionValue)).toBeGreaterThan(0);
    expect(
      parseDecimal(actual.equityValue, "equity")
        .plus(actual.employeeOptionValue)
        .toString(),
    ).toBe(original.equityValue);
    expect(
      parseDecimal(actual.nav.equityValue, "nav")
        .plus(actual.employeeOptionValue)
        .toString(),
    ).toBe(original.nav.equityValue);
    input.employeeEquity.market = null;
    expect(reasons(input)).toContain("employeeEquity.derived");
  });

  it("funds next year's growth and the terminal transition from current AFFO", () => {
    const input = fixtureReitValuation();
    input.scenarios = null;
    input.sensitivity = null;
    input.assumptions.periods[0]!.affoGrowth = "0.04";
    input.assumptions.periods[1]!.affoGrowth = "0.03";
    const result = run(input).result!.base;
    expect(result.periods[0]).toMatchObject({
      affo: "10.4",
      fundedGrowth: "0.03",
      retention: "0.25",
      growthReinvestment: "2.6",
      distributableCash: "7.8",
    });
    expect(result.periods[1]!.fundedGrowth).toBe("0.02");
    expect(Number(result.periods[1]!.retention)).toBeCloseTo(1 / 6, 14);
  });

  it("retains all sixty invalid annual periods across maximum-horizon scenarios", () => {
    const input = fixtureReitValuation();
    input.assumptions.periods = Array.from({ length: 20 }, () => ({
      affoGrowth: "-1",
      returnOnNewEquity: "0",
      equityBeta: "1",
    }));
    input.scenarios = {
      bear: structuredClone(input.assumptions),
      bull: structuredClone(input.assumptions),
    };
    input.scenarios.bear.nav.capRate = "0.07";
    input.scenarios.bull.nav.capRate = "0.05";
    expect(reasons(input)).toHaveLength(60);
  });

  it("higher cap rates lower NAV and higher discount rates lower DCF, ceteris paribus", () => {
    const input = fixtureReitValuation();
    const base = run(input).result!.base;
    for (const cap of ["0.061", "0.07", "0.1", "0.2"]) {
      input.assumptions.nav.capRate = cap;
      expect(Number(run(input).result!.base.nav.valuePerShare)).toBeLessThan(
        Number(base.nav.valuePerShare),
      );
    }
    for (const beta of ["1.5", "2", "3"]) {
      input.assumptions.periods.forEach((p) => {
        p.equityBeta = beta;
      });
      input.assumptions.terminal.equityBeta = beta;
      expect(Number(run(input).result!.base.valuePerShare)).toBeLessThan(
        Number(base.valuePerShare),
      );
    }
  });
});
