import { computeReit } from "../domain/reit";
import { financialCostOfEquity } from "../domain/excess-return";
import {
  computeReitInputHash,
  reitInputSchema,
  type ReitInput,
} from "../domain/reit-input";
import {
  checkReitInput,
  reitFacts,
  checkReitAssumptions,
  checkReitScenarios,
} from "../domain/reit-policy";
import {
  computeReitResultHash,
  reitResultSchema,
  reitRunSchema,
  type ReitRun,
} from "../domain/reit-run";
import { formatDecimal, parseDecimal } from "../domain/decimal-policy";
import { assertNoRejections, type PolicyCheck } from "../domain/policy-checks";
import { isValuationPolicyError } from "../domain/valuation-error";

import type { RunValuationDependencies } from "./run-valuation";

/** No I/O, clock, models or repository lookups: only the frozen snapshot. */
export function runReit(
  candidate: ReitInput,
  dependencies: RunValuationDependencies,
): ReitRun {
  const input = reitInputSchema.parse(candidate);
  const facts = reitFacts(input).flatMap(({ fact }) =>
    fact === null ? [] : [fact],
  );
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
          ...(input.nav === null ? [] : [input.nav.sourceId]),
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
    inputHash: computeReitInputHash(input),
    startedAt: dependencies.now(),
  };
  try {
    const checks: PolicyCheck[] = checkReitInput(input);
    assertNoRejections(checks);
    checks.push(
      ...checkReitAssumptions(input, input.assumptions),
      ...checkReitScenarios(input),
    );
    if (input.scenarios !== null) {
      for (const key of ["bear", "bull"] as const) {
        checks.push(
          ...checkReitAssumptions(
            input,
            input.scenarios[key],
            `scenarios.${key}`,
          ),
        );
      }
    }
    assertNoRejections(checks);
    const base = computeReit(input);
    const scenarios =
      input.scenarios === null
        ? null
        : {
            bear: computeReit(input, input.scenarios.bear),
            bull: computeReit(input, input.scenarios.bull),
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
        id: "reit_scenario_order",
        mode: "require_review",
        status: ordered ? "passed" : "failed",
        subjects: ordered ? [] : ["scenarios"],
        message: "Bear, base and bull should be ordered by value per share.",
      });
    }
    if (
      scenarios !== null &&
      base.nav !== null &&
      scenarios.bear.nav !== null &&
      scenarios.bull.nav !== null
    ) {
      const ordered =
        parseDecimal(scenarios.bear.nav.valuePerShare, "bear.nav").lte(
          parseDecimal(base.nav.valuePerShare, "base.nav"),
        ) &&
        parseDecimal(base.nav.valuePerShare, "base.nav").lte(
          parseDecimal(scenarios.bull.nav.valuePerShare, "bull.nav"),
        );
      checks.push({
        id: "reit_nav_scenario_order",
        mode: "require_review",
        status: ordered ? "passed" : "failed",
        subjects: ordered ? [] : ["scenarios"],
        message:
          "NAV scenarios should be ordered independently from the equity DCF.",
      });
    }
    if (
      base.nav !== null &&
      !parseDecimal(base.nav.equityValue, "nav.equityValue").gt(0)
    ) {
      checks.push({
        id: "reit_nav_nonpositive",
        mode: "require_review",
        status: "failed",
        subjects: ["nav"],
        message:
          "Property NAV does not cover the claims; the signed value is retained for review.",
      });
    }
    const result = reitResultSchema.parse({
      base,
      scenarios,
      navSensitivity:
        input.sensitivity === null || input.assumptions.nav === null
          ? null
          : input.sensitivity.capRates.map((capRate) => {
              const assumptions = {
                ...input.assumptions,
                nav: { ...input.assumptions.nav!, capRate },
              };
              const reasons = checkReitAssumptions(input, assumptions)
                .filter(
                  (check) =>
                    check.mode === "reject" && check.status === "failed",
                )
                .map((check) => check.id);
              return {
                capRate,
                status: reasons.length === 0 ? "computed" : "rejected",
                valuePerShare:
                  reasons.length === 0
                    ? computeReit(input, assumptions).nav!.valuePerShare
                    : null,
                reasons,
              };
            }),
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
                  const failures = checkReitAssumptions(
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
                        valuePerShare: computeReit(input, assumptions)
                          .valuePerShare,
                      };
                }),
              })),
            },
    });
    const finishedAt = dependencies.now();
    return reitRunSchema.parse({
      ...identity,
      status: checks.some(
        (check) => check.mode === "require_review" && check.status === "failed",
      )
        ? "requires_review"
        : "computed",
      result,
      resultHash: computeReitResultHash(identity.inputHash, result),
      failure: null,
      finishedAt,
      recordedAt: finishedAt,
    });
  } catch (error) {
    if (!isValuationPolicyError(error)) throw error;
    const finishedAt = dependencies.now();
    return reitRunSchema.parse({
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

export function replayReitRun(candidate: ReitRun) {
  const recorded = reitRunSchema.parse(candidate);
  const replayed = runReit(recorded.input, {
    now: () => recorded.startedAt,
    newValuationRunId: () => recorded.valuationRunId,
  });
  const divergences = (["inputHash", "resultHash", "status"] as const).filter(
    (key) => recorded[key] !== replayed[key],
  );
  if (
    recorded.result !== null &&
    computeReitResultHash(recorded.inputHash, recorded.result) !==
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
