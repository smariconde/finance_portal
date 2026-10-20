import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { ONE, parseDecimal, ZERO } from "./decimal-policy";
import { employeeEquityMismatches } from "./employee-equity-claim";
import { financialCostOfEquity } from "./excess-return";
import type {
  ExcessReturnInput,
  FinancialAssumptions,
} from "./excess-return-input";
import { selectValuationMethod } from "./method-selection";
import {
  type PolicyCheck,
  hasValidTerminalSpread,
  isGrowthWithinRiskFree,
} from "./policy-checks";

export function excessReturnMissingInputs(input: ExcessReturnInput): string[] {
  return [
    ...(input.commonBookEquity === null ? ["common_book_equity"] : []),
    ...Object.entries(input.risk).flatMap(([key, value]) =>
      value === null ? [`risk.${key}`] : [],
    ),
    ...(input.employeeEquity === null ? ["employee_equity"] : []),
    ...(input.employeeEquityAvailableAt === null
      ? ["employee_equity_availability"]
      : []),
  ];
}

function check(
  id: string,
  mode: PolicyCheck["mode"],
  subjects: string[],
  message: string,
): PolicyCheck {
  return {
    id,
    mode,
    status: subjects.length === 0 ? "passed" : "failed",
    subjects,
    message,
  };
}

/** Structural facts are checked once; every scenario gets its own economic checks. */
export function checkExcessReturnInput(
  input: ExcessReturnInput,
): PolicyCheck[] {
  const missing = excessReturnMissingInputs(input);
  const selection = selectValuationMethod({
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
    evidence: input.profileEvidence,
    fcffInputsComplete: false,
    excessReturnMissingInputs: missing,
  });
  const facts = [
    { path: "commonBookEquity", fact: input.commonBookEquity },
    ...(["riskFree", "matureErp", "countryRiskPremium"] as const).map(
      (key) => ({ path: `risk.${key}`, fact: input.risk[key] }),
    ),
    {
      path: "employeeEquity.sharesOutstanding",
      fact: input.employeeEquity?.sharesOutstanding ?? null,
    },
  ];
  const currency = facts.flatMap(({ path, fact }) =>
    fact !== null && "currency" in fact && fact.currency !== input.currency
      ? [path]
      : [],
  );
  const dates = facts.flatMap(({ path, fact }) =>
    fact !== null &&
    (fact.asOf > input.asOf ||
      (input.knowledge.revisionPolicy === "as_known" &&
        Date.parse(fact.availableAt) > Date.parse(input.knowledge.knownAt)))
      ? [path]
      : [],
  );
  // This fact contract has availability but no recordedAt. Do not pretend that
  // an input assembled from it can prove a system-recorded historical view.
  if (input.knowledge.knowledgeBasis !== "public_availability")
    dates.push("knowledge.knowledgeBasis");
  if (input.knowledge.effectiveAt.slice(0, 10) !== input.asOf)
    dates.push("knowledge.effectiveAt");
  if (
    input.commonBookEquity !== null &&
    input.commonBookEquity.asOf !== input.asOf
  )
    dates.push("commonBookEquity.asOf");

  const employee = input.employeeEquity;
  if (employee !== null && employee.sharesOutstanding.asOf !== input.asOf)
    dates.push("employeeEquity.sharesOutstanding.asOf");
  if (
    input.employeeEquityAvailableAt !== null &&
    input.knowledge.revisionPolicy === "as_known" &&
    Date.parse(input.employeeEquityAvailableAt) >
      Date.parse(input.knowledge.knownAt)
  )
    dates.push("employeeEquityAvailableAt");
  const employeeMismatches =
    employee === null || input.risk.riskFree === null
      ? []
      : employeeEquityMismatches(employee, {
          asOf: input.asOf,
          currency: input.currency,
          riskFree: input.risk.riskFree.value,
        });
  const nonPositiveBook =
    input.commonBookEquity !== null &&
    !parseDecimal(input.commonBookEquity.value, "commonBookEquity").gt(ZERO);
  if (
    employee !== null &&
    (!parseDecimal(
      employee.sharesOutstanding.value,
      "employeeEquity.sharesOutstanding",
    ).gt(ZERO) ||
      !parseDecimal(
        employee.derived.shareCount,
        "employeeEquity.shareCount",
      ).gt(ZERO))
  )
    employeeMismatches.push("employeeEquity.sharesOutstanding.value");
  const negativeRisk = (["matureErp", "countryRiskPremium"] as const).filter(
    (key) =>
      input.risk[key] !== null &&
      parseDecimal(input.risk[key].value, `risk.${key}`).lt(ZERO),
  );
  return [
    check(
      "financial_structural_inputs",
      "reject",
      missing,
      "Common book, dated risk components and employee equity are required.",
    ),
    check(
      "financial_method_selection",
      "reject",
      selection.status === "selected" &&
        selection.assetProfile === input.assetProfile
        ? []
        : ["profileEvidence", "assetProfile"],
      "Only a bank or insurer supported by visible classification evidence uses this model.",
    ),
    check(
      "financial_currency",
      "reject",
      currency,
      "Every monetary and risk component must use the valuation currency.",
    ),
    check(
      "financial_point_in_time",
      "reject",
      [...new Set(dates)],
      "Facts must be visible at the cutoff and common book measured at the valuation date.",
    ),
    check(
      "financial_positive_book",
      "reject",
      nonPositiveBook ? ["commonBookEquity.value"] : [],
      "Nonpositive common book requires a different model.",
    ),
    check(
      "financial_risk_components",
      "reject",
      negativeRisk.map((key) => `risk.${key}`),
      "Equity and country risk premia must be nonnegative.",
    ),
    check(
      "financial_employee_equity",
      "reject",
      employeeMismatches,
      "Options and share count must reproduce from their frozen evidence.",
    ),
    check(
      "financial_regulatory_capital",
      "require_review",
      input.financialReview.regulatoryCapital === null
        ? ["financialReview.regulatoryCapital"]
        : [],
      "Capital adequacy and payout capacity require a dated review.",
    ),
    check(
      "financial_asset_quality",
      "require_review",
      input.financialReview.assetQuality === null
        ? ["financialReview.assetQuality"]
        : [],
      "Loan quality or insurance reserve adequacy requires a dated review.",
    ),
    check(
      "financial_clean_surplus",
      "require_review",
      input.financialReview.cleanSurplus === null
        ? ["financialReview.cleanSurplus"]
        : [],
      "OCI, capital transactions and common equity require a clean-surplus review.",
    ),
    check(
      "financial_country_risk_basis",
      "require_review",
      input.risk.countryRiskBasis === "domicile"
        ? ["risk.countryRiskBasis"]
        : [],
      "Domicile country risk is an explicit approximation.",
    ),
    // Experimental is a property of this version, not a caller-controlled flag.
    check(
      "financial_model_experimental",
      "require_review",
      ["engineVersion"],
      "This financial-equity method is experimental and requires review.",
    ),
  ];
}

export function checkFinancialAssumptions(
  input: ExcessReturnInput,
  assumptions: FinancialAssumptions,
  prefix = "assumptions",
): PolicyCheck[] {
  const invalidPeriods: string[] = [];
  for (const [index, period] of assumptions.periods.entries()) {
    const roe = parseDecimal(period.roe, "roe");
    const payout = parseDecimal(period.payout, "payout");
    const beta = parseDecimal(period.equityBeta, "equityBeta");
    const ke = financialCostOfEquity(input, period.equityBeta);
    // This first slice has no recapitalization or loss-recovery path.
    if (
      roe.lt(ZERO) ||
      payout.lt(ZERO) ||
      payout.gt(ONE) ||
      beta.lt(ZERO) ||
      !ke.gt(ZERO)
    )
      invalidPeriods.push(`${prefix}.periods.${index}`);
  }
  const roe = parseDecimal(assumptions.terminal.roe, "terminal.roe");
  const g = parseDecimal(assumptions.terminal.growth, "terminal.growth");
  const beta = parseDecimal(
    assumptions.terminal.equityBeta,
    "terminal.equityBeta",
  );
  const ke = financialCostOfEquity(input, assumptions.terminal.equityBeta);
  const rf = parseDecimal(input.risk.riskFree!.value, "riskFree");
  return [
    check(
      "financial_period_economics",
      "reject",
      invalidPeriods,
      "ROE and beta must be nonnegative, payout in [0,1] and cost of equity positive.",
    ),
    check(
      "financial_terminal_reinvestment",
      "reject",
      roe.gt(ZERO) && g.gte(ZERO) && g.lte(roe) ? [] : [`${prefix}.terminal`],
      "Terminal ROE must be positive and retention g/ROE in [0,1].",
    ),
    check(
      "financial_terminal_growth",
      "reject",
      beta.gte(ZERO) &&
        ke.gt(ZERO) &&
        hasValidTerminalSpread(ke, g) &&
        isGrowthWithinRiskFree(g, rf)
        ? []
        : [`${prefix}.terminal`],
      "Terminal g cannot exceed risk-free and must leave more than 0.005 below cost of equity.",
    ),
  ];
}

export function checkFinancialScenarioCoherence(
  input: ExcessReturnInput,
): PolicyCheck[] {
  if (input.scenarios === null) return [];
  const problems = (["bear", "bull"] as const).flatMap((key) => {
    const scenario = input.scenarios![key];
    return scenario.periods.length !== input.assumptions.periods.length ||
      computeContentHash({
        periods: scenario.periods,
        terminal: scenario.terminal,
      }) ===
        computeContentHash({
          periods: input.assumptions.periods,
          terminal: input.assumptions.terminal,
        })
      ? [`scenarios.${key}`]
      : [];
  });
  return [
    check(
      "financial_scenario_drivers",
      "reject",
      problems,
      "Scenarios must change economic assumptions and cover the same annual horizon.",
    ),
  ];
}
