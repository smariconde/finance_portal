import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { ONE, parseDecimal, ZERO } from "./decimal-policy";
import { employeeEquityMismatches } from "./employee-equity-claim";
import { financialCostOfEquity } from "./excess-return";
import { selectValuationMethod } from "./method-selection";
import {
  hasValidTerminalSpread,
  isGrowthWithinRiskFree,
  type PolicyCheck,
} from "./policy-checks";
import {
  deriveReitAssumptions,
  isEquityPropertyShare,
  reitPropertyShare,
} from "./derived-reit";
import { reconcileAffo, reitNotAdjusted } from "./reit";
import type { ReitAssumptions, ReitInput } from "./reit-input";
import { parsePrintedAmount } from "./operations-mix-task";

export function reitFacts(input: ReitInput) {
  return [
    ...Object.entries(input.affo).flatMap(([key, fact]) =>
      typeof fact === "object" ? [{ path: `affo.${key}`, fact }] : [],
    ),
    ...Object.entries(input.nav ?? {}).flatMap(([key, fact]) =>
      typeof fact === "object" ? [{ path: `nav.${key}`, fact }] : [],
    ),
    ...(["riskFree", "matureErp", "countryRiskPremium"] as const).map(
      (key) => ({ path: `risk.${key}`, fact: input.risk[key] }),
    ),
    {
      path: "employeeEquity.sharesOutstanding",
      fact: input.employeeEquity?.sharesOutstanding ?? null,
    },
  ];
}

export function reitMissingInputs(input: ReitInput): string[] {
  const notAdjusted = reitNotAdjusted(input).map((key) => `affo.${key}`);
  return [
    ...reitFacts(input).flatMap(({ path, fact }) =>
      fact === null && !notAdjusted.includes(path) ? [path] : [],
    ),
    ...(input.employeeEquity === null ? ["employeeEquity"] : []),
    ...(input.employeeEquityAvailableAt === null
      ? ["employeeEquityAvailableAt"]
      : []),
    ...(input.nav?.availableAt === null ? ["nav.availableAt"] : []),
    ...(input.nav?.sourceDocumentId === null ? ["nav.sourceDocumentId"] : []),
  ];
}

function check(
  id: string,
  subjects: string[],
  message: string,
  mode: PolicyCheck["mode"] = "reject",
): PolicyCheck {
  return {
    id,
    mode,
    status: subjects.length === 0 ? "passed" : "failed",
    subjects,
    message,
  };
}

export function checkReitInput(input: ReitInput): PolicyCheck[] {
  const missing = reitMissingInputs(input);
  const selection = selectValuationMethod({
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
    evidence: input.profileEvidence,
    fcffInputsComplete: false,
    reitMissingInputs: missing,
  });
  const currency: string[] = [];
  const dates: string[] = [];
  const provenance: string[] = [];
  const signs: string[] = [];
  const affoSigned = [
    "affo.commonNetIncome",
    "affo.propertySaleGains",
    "affo.jointVentureAdjustment",
    "affo.straightLineRent",
    "risk.riskFree",
  ];
  for (const { path, fact } of reitFacts(input)) {
    if (fact === null) continue;
    if ("currency" in fact && fact.currency !== input.currency)
      currency.push(path);
    if (fact.sourceDocumentId === null && !path.startsWith("risk."))
      provenance.push(path);
    if (
      fact.asOf > input.asOf ||
      (input.knowledge.revisionPolicy === "as_known" &&
        Date.parse(fact.availableAt) > Date.parse(input.knowledge.knownAt))
    )
      dates.push(path);
    if (path.startsWith("affo.") && fact.asOf !== input.affo.periodEnd)
      dates.push(path);
    // Un snapshot derivado (`affo-nav-1.1.0`) toma las acciones de la
    // carátula, fechadas antes del cierre, igual que `excess-return-1.1.0`.
    if (
      (path.startsWith("nav.") ||
        (path === "employeeEquity.sharesOutstanding" &&
          input.derivedReit === undefined)) &&
      fact.asOf !== input.asOf
    )
      dates.push(path);
    if (!affoSigned.includes(path) && parseDecimal(fact.value, path).lt(ZERO))
      signs.push(path);
  }
  if (input.knowledge.knowledgeBasis !== "public_availability")
    dates.push("knowledge.knowledgeBasis");
  if (
    input.derivedReit === undefined
      ? input.knowledge.effectiveAt.slice(0, 10) !== input.asOf
      : input.knowledge.effectiveAt.slice(0, 10) < input.asOf
  )
    dates.push("knowledge.effectiveAt");
  if (input.nav !== null && input.nav.asOf !== input.asOf)
    dates.push("nav.asOf");
  for (const [path, availability] of [
    ["nav.availableAt", input.nav?.availableAt ?? null],
    ["employeeEquityAvailableAt", input.employeeEquityAvailableAt],
  ] as const) {
    if (
      availability !== null &&
      input.knowledge.revisionPolicy === "as_known" &&
      Date.parse(availability) > Date.parse(input.knowledge.knownAt)
    )
      dates.push(path);
  }
  const days =
    (Date.parse(input.affo.periodEnd) - Date.parse(input.affo.periodStart)) /
      86_400_000 +
    1;
  if (
    days < 350 ||
    days > 380 ||
    input.affo.periodEnd > input.asOf ||
    (Date.parse(input.asOf) - Date.parse(input.affo.periodEnd)) / 86_400_000 >
      380
  )
    dates.push("affo.period");
  let employeeProblems: string[] = [];
  if (input.employeeEquity !== null && input.risk.riskFree !== null) {
    employeeProblems = employeeEquityMismatches(input.employeeEquity, {
      asOf: input.asOf,
      currency: input.currency,
      riskFree: input.risk.riskFree.value,
    });
    if (
      !parseDecimal(input.employeeEquity.sharesOutstanding.value, "shares").gt(
        ZERO,
      ) ||
      !parseDecimal(input.employeeEquity.derived.shareCount, "shares").gt(ZERO)
    )
      employeeProblems.push("employeeEquity.sharesOutstanding.value");
  }
  const notAdjusted = reitNotAdjusted(input);
  const affoPresent = reitFacts(input)
    .filter(({ path }) => path.startsWith("affo."))
    .every(
      ({ path, fact }) =>
        fact !== null ||
        (notAdjusted as string[]).includes(path.slice("affo.".length)),
    );
  const derivation: string[] = [];
  let propertyScope = input.propertyBasis === "equity_property";
  if (input.derivedReit !== undefined) {
    const derived = input.derivedReit;
    const share = reitPropertyShare(
      derived.propertyShare.realEstatePropertyNet.value,
      derived.propertyShare.assets.value,
    );
    if (
      share === null ||
      !share.eq(parseDecimal(derived.propertyShare.share, "share"))
    )
      derivation.push("derivedReit.propertyShare");
    propertyScope &&= share !== null && isEquityPropertyShare(share);
    for (const [key, concept] of Object.entries(derived.affoBasis)) {
      const fact = input.affo[key as keyof typeof derived.affoBasis];
      if ((concept === null) !== (fact === null))
        derivation.push(`derivedReit.affoBasis.${key}`);
    }
    if (affoPresent && derivation.length === 0) {
      const rebuilt = deriveReitAssumptions(
        input,
        derived,
        reconcileAffo(input).affo,
      );
      if (
        rebuilt === null ||
        computeContentHash(rebuilt) !== computeContentHash(input.assumptions)
      )
        derivation.push("assumptions");
    }
  }
  const transcriptionProblems: string[] = [];
  if (input.derivedAffo !== undefined) {
    const { proposal, sourceDocumentId, acceptedAt } = input.derivedAffo;
    const factors = {
      units: "1",
      thousands: "1000",
      millions: "1000000",
      billions: "1000000000",
    };
    const factor = proposal.unit === null ? undefined : factors[proposal.unit];
    if (proposal.decision !== "proposed" || factor === undefined)
      transcriptionProblems.push("derivedAffo.proposal");
    for (const name of [
      "commonNetIncome",
      "realEstateDepreciation",
      "propertySaleGains",
      "realEstateImpairments",
      "jointVentureAdjustment",
      "recurringCapex",
      "straightLineRent",
    ] as const) {
      const printed = proposal.components[name];
      const amount =
        printed === null ? null : parsePrintedAmount(printed.amount);
      const fact = input.affo[name];
      if (
        amount === null ||
        factor === undefined ||
        fact === null ||
        !amount.times(factor).eq(parseDecimal(fact.value, `affo.${name}`)) ||
        fact.sourceDocumentId !== sourceDocumentId ||
        fact.availableAt !== acceptedAt
      )
        transcriptionProblems.push(`affo.${name}`);
    }
  }
  return [
    check(
      "reit_affo_transcription",
      transcriptionProblems,
      "A frozen AI transcription must match every AFFO fact and its 10-K acceptance.",
    ),
    check(
      "reit_structural_inputs",
      missing,
      "Every AFFO component, NAV claim, risk fact and employee decision is explicit; missing is never zero.",
    ),
    check(
      "reit_method_selection",
      selection.status === "selected" && selection.assetProfile === "reit"
        ? []
        : ["profileEvidence"],
      "REIT classification must resolve from visible dated evidence.",
    ),
    check(
      "reit_property_scope",
      propertyScope ? [] : ["propertyBasis"],
      "Mortgage and hybrid REITs require another asset model.",
    ),
    ...(input.derivedReit === undefined
      ? []
      : [
          check(
            "reit_assumptions_derived_recomputed",
            derivation,
            "The XBRL basis, property share and derived assumptions rebuild from the frozen derivation.",
          ),
          check(
            "reit_affo_not_adjusted",
            notAdjusted.map((key) => `affo.${key}`),
            "AFFO components the filer did not tag are left unapplied, never read as zero.",
            "require_review",
          ),
          check(
            "reit_nav_declared_absent",
            input.nav === null ? ["nav"] : [],
            "Without a dated forward NOI and cap rate for the same portfolio the NAV is declared absent.",
            "require_review",
          ),
        ]),
    check(
      "reit_currency",
      currency,
      "Facts and risk components use the valuation currency.",
    ),
    check(
      "reit_point_in_time",
      [...new Set(dates)],
      "Annual facts and NAV evidence must respect the snapshot dates and knowledge cutoff.",
    ),
    check(
      "reit_evidence",
      provenance,
      "Reconciliation and NAV claims require named documents.",
    ),
    check(
      "reit_amount_signs",
      signs,
      "Expenses, assets, claims and risk premia are nonnegative; signed reconciliation entries remain signed.",
    ),
    check(
      "reit_positive_affo",
      affoPresent && !reconcileAffo(input).affo.gt(ZERO) ? ["affo"] : [],
      "Nonpositive AFFO requires a recovery model.",
    ),
    check(
      "reit_employee_equity",
      employeeProblems,
      "Employee options and units reproduce from frozen evidence.",
    ),
    check(
      "reit_country_risk_basis",
      input.risk.countryRiskBasis === "domicile"
        ? ["risk.countryRiskBasis"]
        : [],
      "Domicile country risk is an approximation.",
      "require_review",
    ),
    check(
      "reit_model_experimental",
      ["engineVersion"],
      "AFFO definition, growth funding, leverage/refinancing, taxable distributions, property coverage and cap rates require review.",
      "require_review",
    ),
  ];
}

export function checkReitAssumptions(
  input: ReitInput,
  assumptions: ReitAssumptions,
  prefix = "assumptions",
): PolicyCheck[] {
  const economics: string[] = [];
  const funded = (growth: string, returnOnNewEquity: string) => {
    const g = parseDecimal(growth, "growth");
    const r = parseDecimal(returnOnNewEquity, "returnOnNewEquity");
    return g.gte(ZERO) && r.gt(ZERO) && g.lte(r);
  };
  for (const [index, period] of assumptions.periods.entries()) {
    if (
      parseDecimal(period.affoGrowth, "affoGrowth").lt(ZERO) ||
      !funded(
        assumptions.periods[index + 1]?.affoGrowth ??
          assumptions.terminal.growth,
        period.returnOnNewEquity,
      ) ||
      parseDecimal(period.equityBeta, "beta").lt(ZERO) ||
      !financialCostOfEquity(input, period.equityBeta).gt(ZERO)
    )
      economics.push(`${prefix}.periods.${index}`);
  }
  const t = assumptions.terminal;
  const g = parseDecimal(t.growth, "terminal.growth");
  const ke = financialCostOfEquity(input, t.equityBeta);
  const nav = assumptions.nav;
  return [
    check(
      "reit_growth_funding",
      economics,
      "Annual growth is funded by retained AFFO at a positive incremental equity return; retention stays in [0,1].",
    ),
    check(
      "reit_terminal_funding",
      funded(t.growth, t.returnOnNewEquity) ? [] : [`${prefix}.terminal`],
      "Terminal growth requires sustainable retained AFFO.",
    ),
    check(
      "reit_terminal_growth",
      parseDecimal(t.equityBeta, "beta").gte(ZERO) &&
        ke.gt(ZERO) &&
        hasValidTerminalSpread(ke, g) &&
        isGrowthWithinRiskFree(
          g,
          parseDecimal(input.risk.riskFree!.value, "riskFree"),
        )
        ? []
        : [`${prefix}.terminal`],
      "Terminal growth respects the risk-free ceiling and Ke buffer.",
    ),
    check(
      "reit_nav_capitalization",
      nav === null ||
        (parseDecimal(nav.capRate, "capRate").gt(ZERO) &&
          parseDecimal(nav.capRate, "capRate").lte(ONE) &&
          parseDecimal(nav.forwardNoi, "forwardNoi").gt(ZERO))
        ? []
        : [`${prefix}.nav`],
      "Forward NOI is positive; its cap rate is in (0,1].",
    ),
  ];
}

export function checkReitScenarios(input: ReitInput): PolicyCheck[] {
  const economic = (a: ReitAssumptions) => ({
    periods: a.periods,
    terminal: a.terminal,
    forwardNoi: a.nav?.forwardNoi ?? null,
    capRate: a.nav?.capRate ?? null,
  });
  return [
    check(
      "reit_scenario_drivers",
      input.scenarios === null
        ? []
        : (["bear", "bull"] as const).flatMap((key) => {
            const a = input.scenarios![key];
            return a.periods.length !== input.assumptions.periods.length ||
              computeContentHash(economic(a)) ===
                computeContentHash(economic(input.assumptions))
              ? [`scenarios.${key}`]
              : [];
          }),
      "Scenarios change economic assumptions and retain the same annual horizon.",
    ),
  ];
}
