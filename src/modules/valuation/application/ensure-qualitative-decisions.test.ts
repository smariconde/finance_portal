import { describe, expect, it, vi } from "vitest";

import type {
  LadderAttempt,
  LadderResult,
} from "@/modules/ai/application/run-model-ladder";
import { AiTransferRefusedError } from "@/modules/ai/domain/ai-transfer";

import {
  ensureQualitativeDecisions,
  failureCode,
  type QualitativeDecisionDependencies,
} from "./ensure-qualitative-decisions";
import type { ProposeEmployeeEquityResult } from "./propose-employee-equity";
import type { ProposeOperationsMixResult } from "./propose-operations-mix";
import type { ResolveCompanyIndustryResult } from "./resolve-company-industry";

const ALL = { industry: true, employeeEquity: true, operationsMix: true };

function attempt(chargedNanoUsd: number | null): LadderAttempt {
  return { chargedNanoUsd } as LadderAttempt;
}

function ladder(
  outcome: "accepted" | "abstained" | "stopped",
  chargedNanoUsd = 1_000,
): LadderResult<unknown> {
  const attempts = [attempt(chargedNanoUsd), attempt(null)];

  switch (outcome) {
    case "accepted":
      return {
        taskRunId: "run",
        outcome,
        rung: 2,
        model: "fixture/model",
        output: {},
        attempts,
      };
    case "abstained":
      return {
        taskRunId: "run",
        outcome,
        reason: "insufficient_evidence",
        detail: null,
        attempts,
      };
    case "stopped":
      return {
        taskRunId: "run",
        outcome,
        code: "breaker_open",
        detail: null,
        attempts,
      };
  }
}

const industryAsked = (
  outcome: "accepted" | "abstained" | "stopped",
): ResolveCompanyIndustryResult =>
  ({
    status: "asked",
    ladder: ladder(outcome),
    record: {
      outcome:
        outcome === "accepted"
          ? "resolved"
          : outcome === "abstained"
            ? "abstained"
            : "stopped",
    },
    written: true,
  }) as unknown as ResolveCompanyIndustryResult;

const proposalAsked = <Result>(
  outcome: "accepted" | "abstained" | "stopped",
  written = true,
): Result =>
  ({
    status: "asked",
    ladder: ladder(outcome),
    stored: { proposal: { outcome } },
    written,
  }) as unknown as Result;

function dependencies(
  overrides: Partial<QualitativeDecisionDependencies> = {},
): QualitativeDecisionDependencies {
  return {
    resolveIndustry: vi.fn(async () => industryAsked("accepted")),
    proposeEmployeeEquity: vi.fn(async () =>
      proposalAsked<ProposeEmployeeEquityResult>("accepted"),
    ),
    proposeOperationsMix: vi.fn(async () =>
      proposalAsked<ProposeOperationsMixResult>("abstained"),
    ),
    ...overrides,
  };
}

describe("ensureQualitativeDecisions", () => {
  it("asks only for what the assessment lacks", async () => {
    const deps = dependencies();
    const step = await ensureQualitativeDecisions(
      { industry: false, employeeEquity: true, operationsMix: false },
      deps,
    );

    expect(deps.resolveIndustry).not.toHaveBeenCalled();
    expect(deps.proposeOperationsMix).not.toHaveBeenCalled();
    expect(step).toMatchObject({
      industry: { status: "present" },
      employeeEquity: { status: "accepted", rung: 2 },
      operationsMix: { status: "present" },
      chargedNanoUsd: 1_000,
    });
  });

  it("records every answer and adds up what was charged", async () => {
    const step = await ensureQualitativeDecisions(ALL, dependencies());

    expect(step).toMatchObject({
      ruleVersion: "valuation-qualitative-1.0.0",
      industry: { status: "accepted", rung: 2 },
      employeeEquity: { status: "accepted", rung: 2 },
      operationsMix: { status: "abstained", reason: "insufficient_evidence" },
      chargedNanoUsd: 3_000,
    });
  });

  it("does not run the next tasks once a ladder stops", async () => {
    const deps = dependencies({
      resolveIndustry: vi.fn(async () => industryAsked("stopped")),
    });
    const step = await ensureQualitativeDecisions(ALL, deps);

    expect(step).toMatchObject({
      industry: { status: "stopped", code: "breaker_open" },
      employeeEquity: { status: "not_run" },
      operationsMix: { status: "not_run" },
    });
    expect(deps.proposeEmployeeEquity).not.toHaveBeenCalled();
    expect(deps.proposeOperationsMix).not.toHaveBeenCalled();
  });

  it("keeps going after a task throws, naming the error and never its message", async () => {
    const deps = dependencies({
      proposeEmployeeEquity: vi.fn(async () => {
        throw new AiTransferRefusedError(["yahoo-finance"]);
      }),
    });
    const step = await ensureQualitativeDecisions(ALL, deps);

    expect(step.employeeEquity).toEqual({
      status: "failed",
      code: "ai_transfer_refused",
    });
    expect(step.operationsMix.status).toBe("abstained");
  });

  it("names a skip with the task's own reason", async () => {
    const step = await ensureQualitativeDecisions(
      { industry: true, employeeEquity: false, operationsMix: false },
      dependencies({
        resolveIndustry: vi.fn(
          async () =>
            ({
              status: "skipped",
              reason: "already_asked",
            }) as unknown as ResolveCompanyIndustryResult,
        ),
      }),
    );

    expect(step.industry).toEqual({
      status: "skipped",
      reason: "already_asked",
    });
  });

  it("does not call an accepted answer that was not written a decision", async () => {
    const step = await ensureQualitativeDecisions(
      { industry: false, employeeEquity: true, operationsMix: false },
      dependencies({
        proposeEmployeeEquity: vi.fn(async () =>
          proposalAsked<ProposeEmployeeEquityResult>("accepted", false),
        ),
      }),
    );

    expect(step.employeeEquity).toEqual({
      status: "skipped",
      reason: "not_written",
    });
  });
});

describe("failureCode", () => {
  it("turns the error's name into a code", () => {
    expect(failureCode(new AiTransferRefusedError(["x"]))).toBe(
      "ai_transfer_refused",
    );
    expect(failureCode(new TypeError("boom"))).toBe("type");
  });

  it("falls back when the name is not a code", () => {
    const odd = new Error("x");
    odd.name = "Ünïcode Error!";

    expect(failureCode(odd)).toBe("task_error");
    expect(failureCode("not an error")).toBe("task_error");
  });
});
