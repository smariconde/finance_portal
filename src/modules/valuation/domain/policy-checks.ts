import { divide, ONE, parseDecimal, ZERO, type Dec } from "./decimal-policy";
import type { FcffComputation } from "./fcff";
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

/** Checks que dependen sólo del snapshot: corren antes de calcular. */
export function checkValuationInput(input: ValuationInput): PolicyCheck[] {
  const checks: PolicyCheck[] = [];

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

  const dilutedShares = parseDecimal(
    input.dilutedShares.value,
    "dilutedShares.value",
  );

  checks.push(
    check(
      "diluted_shares_positive",
      "reject",
      dilutedShares.gt(ZERO),
      "Diluted shares must be strictly positive and dated.",
      ["dilutedShares.value"],
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
