import { failureRiskMismatches } from "./failure-risk";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import { divide, ONE, parseDecimal, ZERO, type Dec } from "./decimal-policy";
import type { FcffComputation } from "./fcff";
import { capitalizationMismatches } from "./capitalization-bridge";
import { deriveCostOfCapital, marginalTaxRateOf } from "./cost-of-capital";
import { employeeEquityMismatches } from "./employee-equity-claim";
import { normalizationMismatches } from "./normalization";
import { qualitativeDecisionMismatches } from "./qualitative-decisions";
import { SCENARIO_KEYS, scenarioDriverMismatches } from "./scenarios";
import { deriveRigorLevel } from "./rigor-level";
import { ValuationPolicyError } from "./valuation-error";
import {
  BRIDGE_ITEM_KEYS,
  listMonetaryFacts,
  type ValuationInput,
} from "./valuation-input";

/**
 * Policy checks del motor (`docs/valuation/methodology.md`, sección "Policy
 * checks"). `reject` detiene la corrida; `require_review` la deja calcular pero
 * la marca, porque un resultado plausible sin revisión es más peligroso que uno
 * rechazado. Ninguna corrección es silenciosa.
 *
 * Los umbrales forman parte de `engine_version`: cambiarlos no reescribe
 * corridas históricas.
 */
export const TERMINAL_SPREAD_BUFFER = "0.005";
export const TERMINAL_VALUE_SHARE_THRESHOLD = "0.85";
export const TAX_RATE_REVIEW_CEILING = "0.5";
export const TERMINAL_MARGIN_REVIEW_CEILING = "0.6";

export type PolicyCheckMode = "reject" | "require_review";

export type PolicyCheck = {
  id: string;
  mode: PolicyCheckMode;
  status: "passed" | "failed";
  message: string;
  /** Rutas de campo, nunca valores recibidos (`TM-02`). */
  subjects: readonly string[];
};

function check(
  id: string,
  mode: PolicyCheckMode,
  passed: boolean,
  message: string,
  subjects: readonly string[] = [],
): PolicyCheck {
  return {
    id,
    mode,
    status: passed ? "passed" : "failed",
    message,
    subjects: passed ? [] : [...subjects],
  };
}

/**
 * `terminal_wacc > terminal_growth + buffer`. Es la precondición que impide una
 * perpetuidad con denominador cercano a cero, y también decide qué celdas de la
 * sensibilidad son inválidas.
 */
export function hasValidTerminalSpread(wacc: Dec, growth: Dec): boolean {
  return wacc.gt(growth.plus(parseDecimal(TERMINAL_SPREAD_BUFFER, "buffer")));
}

/**
 * `terminal_growth <= risk_free` (`F4-02`, `fcff-1.2.0`). Es la regla
 * económica de Damodaran: ninguna empresa crece a perpetuidad más rápido que
 * la economía de su moneda, y la libre de riesgo nominal es el techo observable
 * de esa economía. La libre de riesgo es la que el costo de capital de la
 * corrida deriva —el bono del Tesoro neto del default spread del soberano de la
 * moneda—, así que el techo está fechado y en la moneda de la valuación. El
 * borde es inclusivo: crecer exactamente a la libre de riesgo es el caso límite
 * que Damodaran admite. El buffer contra el WACC sigue siendo la defensa
 * aritmética; no reemplaza a esta regla ni esta a él.
 */
export function isGrowthWithinRiskFree(growth: Dec, riskFree: Dec): boolean {
  return growth.lte(riskFree);
}

/**
 * Checks de la Fase 3: la corrida valúa lo que el selector eligió, con el rigor
 * que la completitud deriva. El rigor se **recalcula** desde el snapshot; uno
 * escrito a mano que no coincide se rechaza, porque el nivel no se elige.
 */
function checkAssessment(input: ValuationInput): PolicyCheck[] {
  const { selection, completeness, rigor } = input.assessment;
  const derived = deriveRigorLevel(selection, completeness);

  return [
    check(
      "method_selection_admits_run",
      "reject",
      selection.status === "selected" &&
        selection.assetProfile === input.assetProfile &&
        selection.recommendedMethod === input.method,
      "The run must value the profile and method the selector chose.",
      ["assessment.selection", "assetProfile", "method"],
    ),
    check(
      "rigor_derived_from_completeness",
      "reject",
      computeContentHash(derived) === computeContentHash(rigor),
      "The rigor level is derived from the completeness profile, never chosen.",
      ["assessment.rigor"],
    ),
    check(
      "rigor_admits_valuation",
      "reject",
      rigor.level !== "unsupported",
      "An unsupported rigor level does not value; it names what is missing.",
      ["assessment.rigor.level"],
    ),
  ];
}

/**
 * El WACC no es un input crudo (`F3-06`): se recalcula desde los componentes
 * fechados del snapshot, y los períodos tienen que empezar en el WACC de hoy,
 * terminar en el terminal y no salirse del camino entre los dos.
 */
function checkCostOfCapital(input: ValuationInput): PolicyCheck[] {
  const { costOfCapital } = input;
  const rebuilt = deriveCostOfCapital(
    costOfCapital.parameters,
    costOfCapital.derived.syntheticRating,
    costOfCapital.operationsExposure ?? null,
  );
  const wacc = parseDecimal(costOfCapital.derived.wacc, "costOfCapital.wacc");
  const terminal = parseDecimal(
    costOfCapital.derived.terminalWacc,
    "costOfCapital.terminalWacc",
  );
  const low = wacc.lte(terminal) ? wacc : terminal;
  const high = wacc.lte(terminal) ? terminal : wacc;
  const first = input.periods[0];
  const offPath = input.periods
    .filter((period) => {
      const value = parseDecimal(period.wacc, "wacc");
      return value.lt(low) || value.gt(high);
    })
    .map((period) => `periods.${period.periodIndex - 1}.wacc`);

  const derivedMatches =
    computeContentHash(rebuilt) === computeContentHash(costOfCapital.derived);
  const startsAtWacc =
    first !== undefined && parseDecimal(first.wacc, "wacc").eq(wacc);
  const endsAtTerminal = parseDecimal(input.terminal.wacc, "terminal.wacc").eq(
    terminal,
  );

  return [
    check(
      "wacc_built_from_components",
      "reject",
      derivedMatches &&
        costOfCapital.currency === input.currency &&
        startsAtWacc &&
        endsAtTerminal &&
        offPath.length === 0,
      "Period and terminal WACC must be the ones the dated cost of capital derives, converging from one to the other.",
      [
        ...(derivedMatches ? [] : ["costOfCapital.derived"]),
        ...(costOfCapital.currency === input.currency
          ? []
          : ["costOfCapital.currency"]),
        ...(startsAtWacc ? [] : ["periods.0.wacc"]),
        ...(endsAtTerminal ? [] : ["terminal.wacc"]),
        ...offPath,
      ],
    ),
  ];
}

/**
 * La industria y los pesos del CRP son los que las decisiones congeladas en el
 * snapshot derivan (`F5-06`): el replay no consulta las tablas de propuestas,
 * así que el snapshot tiene que explicarse solo.
 */
function checkQualitativeDecisions(input: ValuationInput): PolicyCheck[] {
  const mismatches = qualitativeDecisionMismatches(
    input.qualitativeDecisions,
    input.costOfCapital,
  );

  return [
    check(
      "qualitative_decisions_drive_cost_of_capital",
      "reject",
      mismatches.length === 0,
      "Industry and operations weights must be the ones the recorded qualitative decisions derive.",
      mismatches,
    ),
  ];
}

/**
 * La capitalización no es un input crudo (`F4-01`, ADR 0037): se recalcula
 * desde sus hechos con la industria y el costo de deuda de la corrida, sus
 * hechos son del cierre del año base, y la deuda por arrendamientos que deriva
 * es exactamente la claim `leaseDebt` del puente EV-equity.
 */
function checkCapitalization(input: ValuationInput): PolicyCheck[] {
  const { capitalization, costOfCapital } = input;
  const mismatches = capitalizationMismatches(capitalization, {
    baseRevenue: input.baseRevenue.value,
    industryKey: costOfCapital.industryKey,
    preTaxCostOfDebt: costOfCapital.derived.preTaxCostOfDebt,
  });

  if (input.baseRevenue.asOf !== capitalization.baseFiscalYearEnd) {
    mismatches.push("capitalization.baseFiscalYearEnd");
  }

  const leases = capitalization.leases.result;
  const claim = input.bridge.leaseDebt;
  const claimMatches =
    leases.status === "capitalized"
      ? claim.status === "reported" &&
        claim.amount !== null &&
        claim.amount.asOf === capitalization.baseFiscalYearEnd &&
        parseDecimal(claim.amount.value, "bridge.leaseDebt").eq(
          parseDecimal(leases.leaseDebt, "capitalization.leases.leaseDebt"),
        )
      : claim.status !== "reported";

  if (!claimMatches) {
    mismatches.push("bridge.leaseDebt");
  }

  return [
    check(
      "capitalization_recomputed",
      "reject",
      mismatches.length === 0,
      "Capitalized leases and R&D must be the ones their dated facts derive, and the lease debt must be the bridge's leaseDebt claim.",
      mismatches,
    ),
  ];
}

/**
 * La normalización no es un input crudo (`F4-03`, ADR 0038): se recalcula
 * desde sus hechos con las ventas, la tasa marginal y la capitalización de la
 * corrida, y la deuda y la caja del puente EV-equity son exactamente las que
 * deriva. Sin deuda o caja resuelta la claim no puede ser `reported`: queda
 * `missing`, que se rechaza, o declarada ausente por el owner con motivo.
 */
function checkNormalization(input: ValuationInput): PolicyCheck[] {
  const { normalization } = input;
  const mismatches = normalizationMismatches(normalization, {
    baseRevenue: input.baseRevenue.value,
    marginalTaxRate: marginalTaxRateOf(input.costOfCapital),
    capitalization: input.capitalization,
  });
  const base = normalization.facts.baseFiscalYearEnd;

  if (input.baseRevenue.asOf !== base) {
    mismatches.push("normalization.facts.baseFiscalYearEnd");
  }

  const claimMatches = (
    claim: ValuationInput["bridge"]["debt"],
    derived: { status: "resolved"; total: string } | { status: "unresolved" },
    path: string,
  ) =>
    derived.status === "resolved"
      ? claim.status === "reported" &&
        claim.amount !== null &&
        claim.amount.asOf === base &&
        parseDecimal(claim.amount.value, path).eq(
          parseDecimal(derived.total, "normalization.total"),
        )
      : claim.status !== "reported";

  if (!claimMatches(input.bridge.debt, normalization.debt, "bridge.debt")) {
    mismatches.push("bridge.debt");
  }

  if (
    !claimMatches(
      input.bridge.excessCash,
      normalization.excessCash,
      "bridge.excessCash",
    )
  ) {
    mismatches.push("bridge.excessCash");
  }

  return [
    check(
      "normalization_recomputed",
      "reject",
      mismatches.length === 0,
      "The normalized base must be the one its dated facts derive, and debt and excess cash must be the bridge's claims.",
      [...new Set(mismatches)],
    ),
  ];
}

/**
 * Bear y bull cambian supuestos que la base tiene (`F4-04`, ADR 0039): un
 * valor por período explícito, en la convención de reinversión del período, y
 * cada valor declarado distinto del de la base. Sin escenarios no hay check:
 * una corrida con un único conjunto de supuestos no declara nada que verificar.
 */
function checkScenarioDeclarations(input: ValuationInput): PolicyCheck[] {
  const { scenarios } = input;

  if (scenarios === null) {
    return [];
  }

  const mismatches = SCENARIO_KEYS.flatMap((key) =>
    scenarioDriverMismatches(input, key, scenarios[key]),
  );

  return [
    check(
      "scenario_drivers_declared",
      "reject",
      mismatches.length === 0,
      "A scenario driver covers every explicit period in the base's convention and each declared value changes the base.",
      mismatches.slice(0, 32),
    ),
  ];
}

/**
 * Opciones y unidades no son inputs crudos (`F4-05`, ADR 0040): el valor de
 * las opciones y el denominador se recalculan desde la decisión, las acciones
 * y el mercado con la libre de riesgo de la corrida, y la claim
 * `employeeOptions` del puente es exactamente ese valor —o una ausencia
 * declarada cuando la nota no tiene opciones—.
 */
function checkEmployeeEquity(input: ValuationInput): PolicyCheck[] {
  const { employeeEquity } = input;
  const mismatches = employeeEquityMismatches(employeeEquity, {
    riskFree: input.costOfCapital.derived.riskFree,
    currency: input.currency,
    asOf: input.asOf,
  });
  const claim = input.bridge.employeeOptions;
  const options = employeeEquity.derived.options;
  const claimMatches =
    options === null
      ? claim.status === "declared_absent"
      : claim.status === "reported" &&
        claim.amount !== null &&
        claim.amount.currency === input.currency &&
        parseDecimal(claim.amount.value, "bridge.employeeOptions").eq(
          parseDecimal(options.totalValue, "employeeEquity.options.totalValue"),
        );

  if (!claimMatches) {
    mismatches.push("bridge.employeeOptions");
  }

  return [
    check(
      "employee_equity_recomputed",
      "reject",
      mismatches.length === 0,
      "Employee options and the share count must be the ones the frozen transcription, shares and market derive, and the bridge must subtract that option value.",
      mismatches,
    ),
  ];
}

function checkFailureRisk(input: ValuationInput): PolicyCheck[] {
  const mismatches = failureRiskMismatches(input.failureRisk, {
    syntheticRating: input.costOfCapital.derived.syntheticRating,
    legalEntityId: input.subject.legalEntityId,
    knowledge: input.knowledge,
  });
  if (input.normalization.investedCapital.status !== "resolved")
    mismatches.push("normalization.investedCapital");
  return [
    check(
      "failure_risk_recomputed",
      "reject",
      mismatches.length === 0,
      "Failure probability must follow the dated rating or an explicit owner decision; recovery uses reported book capital.",
      mismatches,
    ),
  ];
}

/** Checks que dependen sólo del snapshot: corren antes de calcular. */
export function checkValuationInput(input: ValuationInput): PolicyCheck[] {
  const checks: PolicyCheck[] = [
    ...checkAssessment(input),
    ...checkCostOfCapital(input),
    ...checkQualitativeDecisions(input),
    ...checkCapitalization(input),
    ...checkNormalization(input),
    ...checkEmployeeEquity(input),
    ...checkFailureRisk(input),
    ...checkScenarioDeclarations(input),
  ];

  const mismatchedCurrency = listMonetaryFacts(input)
    .filter(({ fact }) => fact.currency !== input.currency)
    .map(({ path }) => path);

  checks.push(
    check(
      "currency_and_unit_consistency",
      "reject",
      mismatchedCurrency.length === 0,
      "Monetary facts must share the valuation currency; no conversion is traced in this snapshot.",
      mismatchedCurrency,
    ),
  );

  const missingClaims = BRIDGE_ITEM_KEYS.filter(
    (key) => input.bridge[key].status === "missing",
  ).map((key) => `bridge.${key}`);

  checks.push(
    check(
      "required_inputs_present",
      "reject",
      missingClaims.length === 0,
      "A missing claim is not zero; record the amount or declare its absence with a rationale.",
      missingClaims,
    ),
  );

  const shareCount = parseDecimal(
    input.employeeEquity.derived.shareCount,
    "employeeEquity.derived.shareCount",
  );

  checks.push(
    check(
      "share_count_positive",
      "reject",
      shareCount.gt(ZERO),
      "Diluted shares must be strictly positive and dated.",
      ["employeeEquity.derived.shareCount"],
    ),
  );

  const nonPositiveDiscount = input.periods
    .filter((period) => ONE.plus(parseDecimal(period.wacc, "wacc")).lte(ZERO))
    .map((period) => `periods.${period.periodIndex - 1}.wacc`);

  checks.push(
    check(
      "discount_factor_defined",
      "reject",
      nonPositiveDiscount.length === 0,
      "Each period needs 1 + wacc strictly positive to define a discount factor.",
      nonPositiveDiscount,
    ),
  );

  const nonPositiveSalesToCapital = input.periods
    .filter(
      (period) =>
        period.reinvestment.convention === "sales_to_capital" &&
        parseDecimal(period.reinvestment.salesToCapital, "salesToCapital").lte(
          ZERO,
        ),
    )
    .map((period) => `periods.${period.periodIndex - 1}.reinvestment`);

  checks.push(
    check(
      "sales_to_capital_positive",
      "reject",
      nonPositiveSalesToCapital.length === 0,
      "Sales-to-capital must be strictly positive.",
      nonPositiveSalesToCapital,
    ),
  );

  const conventions = new Set(
    input.periods.map((period) => period.reinvestment.convention),
  );

  checks.push(
    check(
      "reinvestment_convention_bridge",
      "reject",
      conventions.size <= 1 || input.reinvestmentConventionBridge !== null,
      "Mixing sales-to-capital and growth/ROIC requires an explicit recorded bridge.",
      ["reinvestmentConventionBridge"],
    ),
  );

  const terminalGrowth = parseDecimal(input.terminal.growth, "terminal.growth");
  const terminalWacc = parseDecimal(input.terminal.wacc, "terminal.wacc");
  const riskFree = parseDecimal(
    input.costOfCapital.derived.riskFree,
    "costOfCapital.derived.riskFree",
  );

  checks.push(
    check(
      "terminal_growth_versus_risk_free",
      "reject",
      isGrowthWithinRiskFree(terminalGrowth, riskFree),
      "Terminal growth must not exceed the risk-free rate of the valuation currency.",
      ["terminal.growth", "costOfCapital.derived.riskFree"],
    ),
  );

  checks.push(
    check(
      "terminal_growth_versus_wacc",
      "reject",
      hasValidTerminalSpread(terminalWacc, terminalGrowth),
      `Terminal wacc must exceed terminal growth by more than ${TERMINAL_SPREAD_BUFFER}.`,
      ["terminal.wacc", "terminal.growth"],
    ),
  );

  const terminalRoic = parseDecimal(
    input.terminal.returnOnCapital,
    "terminal.returnOnCapital",
  );
  const terminalReinvestmentRate = terminalRoic.isZero()
    ? null
    : divide(terminalGrowth, terminalRoic, "terminal.returnOnCapital");

  checks.push(
    check(
      "terminal_reinvestment_coherence",
      "reject",
      terminalReinvestmentRate !== null &&
        terminalReinvestmentRate.gte(ZERO) &&
        terminalReinvestmentRate.lte(ONE),
      "Terminal reinvestment must stay between zero and one and sustain the terminal growth.",
      ["terminal.growth", "terminal.returnOnCapital"],
    ),
  );

  const taxCeiling = parseDecimal(TAX_RATE_REVIEW_CEILING, "taxCeiling");
  const outOfRangeTax = [
    ...input.periods
      .filter((period) => {
        const rate = parseDecimal(period.taxRate, "taxRate");

        return rate.lt(ZERO) || rate.gt(taxCeiling);
      })
      .map((period) => `periods.${period.periodIndex - 1}.taxRate`),
    ...(parseDecimal(input.terminal.taxRate, "terminal.taxRate").lt(ZERO) ||
    parseDecimal(input.terminal.taxRate, "terminal.taxRate").gt(taxCeiling)
      ? ["terminal.taxRate"]
      : []),
  ];

  checks.push(
    check(
      "tax_rate_range",
      "require_review",
      outOfRangeTax.length === 0,
      `A tax rate outside 0 and ${TAX_RATE_REVIEW_CEILING} needs a documented rationale.`,
      outOfRangeTax,
    ),
  );

  const terminalMargin = parseDecimal(
    input.terminal.ebitMargin,
    "terminal.ebitMargin",
  );

  checks.push(
    check(
      "terminal_margin_range",
      "require_review",
      terminalMargin.gte(ZERO) &&
        terminalMargin.lte(
          parseDecimal(TERMINAL_MARGIN_REVIEW_CEILING, "marginCeiling"),
        ),
      `A terminal margin outside 0 and ${TERMINAL_MARGIN_REVIEW_CEILING} needs sector evidence.`,
      ["terminal.ebitMargin"],
    ),
  );

  return checks;
}

/** Checks que sólo pueden evaluarse con el resultado ya calculado. */
export function checkValuationOutput(
  computation: FcffComputation,
): PolicyCheck[] {
  const terminalShare =
    computation.terminalValueShare === null
      ? null
      : parseDecimal(computation.terminalValueShare, "terminalValueShare");

  return [
    check(
      "terminal_value_share",
      "require_review",
      terminalShare !== null &&
        terminalShare.lte(
          parseDecimal(TERMINAL_VALUE_SHARE_THRESHOLD, "shareThreshold"),
        ),
      `A terminal value above ${TERMINAL_VALUE_SHARE_THRESHOLD} of enterprise value carries most of the answer.`,
      ["terminal.presentValue"],
    ),
    check(
      "equity_value_positive",
      "require_review",
      parseDecimal(computation.equityValue, "equityValue").gt(ZERO),
      "A non-positive equity value is a legitimate outcome but must be read as such, not as a price.",
      ["equityValue"],
    ),
  ];
}

/**
 * `bear <= base <= bull` en valor por acción (`F4-04`). Un desorden puede ser
 * legítimo —crecer con un retorno sobre el capital por debajo del WACC
 * destruye valor—, pero contradice las etiquetas, así que la corrida se
 * calcula y queda para revisión.
 */
export function checkScenarioOrder(values: {
  bear: string;
  base: string;
  bull: string;
}): PolicyCheck {
  const bear = parseDecimal(values.bear, "scenarios.bear.valuePerShare");
  const base = parseDecimal(values.base, "valuePerShare");
  const bull = parseDecimal(values.bull, "scenarios.bull.valuePerShare");

  return check(
    "scenario_value_order",
    "require_review",
    bear.lte(base) && base.lte(bull),
    "Bear, base and bull values per share must be ordered; a reversal contradicts the labels.",
    [
      ...(bear.lte(base) ? [] : ["scenarios.bear.valuePerShare"]),
      ...(base.lte(bull) ? [] : ["scenarios.bull.valuePerShare"]),
    ],
  );
}

export function failedChecks(
  checks: readonly PolicyCheck[],
  mode: PolicyCheckMode,
): readonly PolicyCheck[] {
  return checks.filter(
    (entry) => entry.mode === mode && entry.status === "failed",
  );
}

/** Un `reject` detiene la corrida con los IDs que fallaron, sin valores. */
export function assertNoRejections(checks: readonly PolicyCheck[]): void {
  const rejected = failedChecks(checks, "reject");

  if (rejected.length > 0) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      `Valuation rejected by policy checks: ${rejected
        .map((entry) => entry.id)
        .join(", ")}.`,
      rejected.flatMap((entry) => entry.subjects),
    );
  }
}
