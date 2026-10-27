import {
  computeExcessReturn,
  financialCostOfEquity,
} from "../domain/excess-return";
import {
  computeExcessReturnInputHash,
  excessReturnInputSchema,
  type ExcessReturnInput,
} from "../domain/excess-return-input";
import {
  checkExcessReturnInput,
  checkFinancialAssumptions,
  checkFinancialScenarioCoherence,
} from "../domain/excess-return-policy";
import {
  computeExcessReturnResultHash,
  excessReturnResultSchema,
  excessReturnRunSchema,
  type ExcessReturnRun,
} from "../domain/excess-return-run";
import { formatDecimal, parseDecimal } from "../domain/decimal-policy";
import { assertNoRejections, type PolicyCheck } from "../domain/policy-checks";
import { isValuationPolicyError } from "../domain/valuation-error";

import type { RunValuationDependencies } from "./run-valuation";

/** No I/O, clock, models or repository lookups: only the frozen snapshot. */
export function runExcessReturn(
  candidate: ExcessReturnInput,
  dependencies: RunValuationDependencies,
): ExcessReturnRun {
  const input = excessReturnInputSchema.parse(candidate);
  const facts = [
    input.commonBookEquity,
    input.risk.riskFree,
    input.risk.matureErp,
    input.risk.countryRiskPremium,
    input.employeeEquity?.sharesOutstanding ?? null,
    input.derivedFinancial?.commonIncome ?? null,
    input.derivedFinancial?.priorBook ?? null,
    input.derivedFinancial?.equityBeta ?? null,
  ].filter((fact) => fact !== null);
  const identity = {
    valuationRunId: dependencies.newValuationRunId(),
    method: input.method,
    subject: input.subject,
    asOf: input.asOf,
    currency: input.currency,
    assetProfile: input.assetProfile,
    engineVersion: input.engineVersion,
    methodologyVersion: input.methodologyVersion,
    decimalPolicy: input.decimalPolicy,
    provenance: {
      sourceIds: [
        ...new Set([
          ...facts.map((fact) => fact.sourceId),
          ...input.profileEvidence.map((evidence) => evidence.sourceId),
          ...(input.derivedFinancial === undefined
            ? []
            : ["owner-financial-declaration"]),
        ]),
      ].sort(),
      observationIds: [
        ...new Set(
          facts.flatMap((fact) =>
            fact.observationId === null ? [] : [fact.observationId],
          ),
        ),
      ].sort(),
      knowledge: input.knowledge,
    },
    input,
    inputHash: computeExcessReturnInputHash(input),
    startedAt: dependencies.now(),
  };
  try {
    const checks: PolicyCheck[] = checkExcessReturnInput(input);
    assertNoRejections(checks);
    checks.push(
      ...checkFinancialAssumptions(input, input.assumptions),
      ...checkFinancialScenarioCoherence(input),
    );
    if (input.scenarios !== null) {
      for (const key of ["bear", "bull"] as const) {
        checks.push(
          ...checkFinancialAssumptions(
            input,
            input.scenarios[key],
            `scenarios.${key}`,
          ),
        );
      }
    }
    assertNoRejections(checks);
    const base = computeExcessReturn(input);
    const scenarios =
      input.scenarios === null
        ? null
        : {
            bear: computeExcessReturn(input, input.scenarios.bear),
            bull: computeExcessReturn(input, input.scenarios.bull),
          };
    if (scenarios !== null) {
      const ordered =
        parseDecimal(scenarios.bear.valuePerShare, "bear").lte(
          parseDecimal(base.valuePerShare, "base"),
        ) &&
        parseDecimal(base.valuePerShare, "base").lte(
          parseDecimal(scenarios.bull.valuePerShare, "bull"),
        );
      checks.push({
        id: "financial_scenario_order",
        mode: "require_review",
        status: ordered ? "passed" : "failed",
        subjects: ordered ? [] : ["scenarios"],
        message: "Bear, base and bull should be ordered by value per share.",
      });
    }
    const result = excessReturnResultSchema.parse({
      base,
      scenarios,
      checks,
      modelStatus: "experimental",
      rigor: "screening",
      sensitivity:
        input.sensitivity === null
          ? null
          : {
              unit: "value_per_share",
              currency: input.currency,
              terminalGrowthRates: input.sensitivity.terminalGrowthRates,
              rows: input.sensitivity.terminalEquityBetas.map((equityBeta) => ({
                terminalEquityBeta: equityBeta,
                terminalCostOfEquity: formatDecimal(
                  financialCostOfEquity(input, equityBeta),
                  "sensitivity.costOfEquity",
                ),
                cells: input.sensitivity!.terminalGrowthRates.map((growth) => {
                  const assumptions = {
                    ...input.assumptions,
                    terminal: {
                      ...input.assumptions.terminal,
                      equityBeta,
                      growth,
                    },
                  };
                  const failures = checkFinancialAssumptions(
                    input,
                    assumptions,
                  ).filter(
                    (check) =>
                      check.mode === "reject" && check.status === "failed",
                  );
                  return failures.length > 0
                    ? {
                        status: "rejected",
                        reasons: failures.map((check) => check.id),
                      }
                    : {
                        status: "computed",
                        valuePerShare: computeExcessReturn(input, assumptions)
                          .valuePerShare,
                      };
                }),
              })),
            },
    });
    const finishedAt = dependencies.now();
    return excessReturnRunSchema.parse({
      ...identity,
      status: checks.some(
        (check) => check.mode === "require_review" && check.status === "failed",
      )
        ? "requires_review"
        : "computed",
      result,
      resultHash: computeExcessReturnResultHash(identity.inputHash, result),
      failure: null,
      finishedAt,
      recordedAt: finishedAt,
    });
  } catch (error) {
    if (!isValuationPolicyError(error)) throw error;
    const finishedAt = dependencies.now();
    return excessReturnRunSchema.parse({
      ...identity,
      status: "rejected",
      result: null,
      resultHash: null,
      failure: {
        code: error.code,
        message: error.message.slice(0, 240),
        subjects: error.subjects,
      },
      finishedAt,
      recordedAt: finishedAt,
    });
  }
}

export function replayExcessReturnRun(candidate: ExcessReturnRun) {
  const recorded = excessReturnRunSchema.parse(candidate);
  const replayed = runExcessReturn(recorded.input, {
    now: () => recorded.startedAt,
    newValuationRunId: () => recorded.valuationRunId,
  });
  const divergences = (["inputHash", "resultHash", "status"] as const).filter(
    (key) => recorded[key] !== replayed[key],
  );
  if (
    recorded.result !== null &&
    computeExcessReturnResultHash(recorded.inputHash, recorded.result) !==
      recorded.resultHash &&
    !divergences.includes("resultHash")
  )
    divergences.push("resultHash");
  return {
    outcome:
      divergences.length === 0
        ? ("reproduced" as const)
        : ("diverged" as const),
    divergences,
  };
}
