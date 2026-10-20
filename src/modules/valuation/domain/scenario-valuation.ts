import { computeFcff, type FcffComputation } from "./fcff";
import {
  checkScenarioOrder,
  checkValuationInput,
  checkValuationOutput,
  failedChecks,
  type PolicyCheck,
} from "./policy-checks";
import {
  materializeScenario,
  SCENARIO_KEYS,
  SCENARIO_SET_VERSION,
  type ScenarioKey,
} from "./scenarios";
import {
  isValuationPolicyError,
  ValuationPolicyError,
} from "./valuation-error";
import type { ValuationInput } from "./valuation-input";

/**
 * Valuación de bear y bull (`F4-04`, ADR 0039). Cada escenario se materializa
 * como un snapshot completo y pasa por **los mismos** checks de entrada y de
 * salida que la base, y por el mismo motor: no hay un camino más corto para
 * un escenario que para la corrida.
 *
 * Un `reject` en un escenario rechaza la corrida entera —publicar un rango con
 * un extremo indefinido sería peor que no publicarlo— y nombra el escenario
 * en cada ruta (`scenarios.bear:terminal.growth`). Un `require_review` se
 * propaga al estado de la corrida.
 */
export type ScenarioOutcome = Pick<
  FcffComputation,
  | "periods"
  | "terminal"
  | "enterpriseValue"
  | "equityValue"
  | "valuePerShare"
  | "terminalValueShare"
> & {
  checks: readonly PolicyCheck[];
};

export type ScenarioValuation = {
  version: typeof SCENARIO_SET_VERSION;
  bear: ScenarioOutcome;
  bull: ScenarioOutcome;
  /** `scenario_value_order`, contra el valor por acción de la base. */
  orderCheck: PolicyCheck;
};

function scoped(key: ScenarioKey, subjects: readonly string[]): string[] {
  return subjects.map((subject) => `scenarios.${key}:${subject}`).slice(0, 32);
}

function valueScenario(
  input: ValuationInput,
  key: ScenarioKey,
): ScenarioOutcome {
  const scenario = input.scenarios?.[key];

  if (scenario === undefined) {
    throw new Error(`Scenario ${key} is not declared in this snapshot.`);
  }

  const materialized = materializeScenario(input, scenario);
  const inputChecks = checkValuationInput(materialized);
  const rejected = failedChecks(inputChecks, "reject");

  if (rejected.length > 0) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      `Scenario ${key} rejected by policy checks: ${rejected
        .map((entry) => entry.id)
        .join(", ")}.`,
      scoped(
        key,
        rejected.flatMap((entry) => entry.subjects),
      ),
    );
  }

  let computation: FcffComputation;

  try {
    computation = computeFcff(materialized);
  } catch (error) {
    if (!isValuationPolicyError(error)) {
      throw error;
    }

    throw new ValuationPolicyError(
      error.code,
      `Scenario ${key}: ${error.message}`,
      scoped(key, error.subjects),
    );
  }

  const outputChecks = checkValuationOutput(computation);
  const outputRejected = failedChecks(outputChecks, "reject");

  if (outputRejected.length > 0) {
    throw new ValuationPolicyError(
      "policy_check_failed",
      `Scenario ${key} rejected by policy checks: ${outputRejected
        .map((entry) => entry.id)
        .join(", ")}.`,
      scoped(
        key,
        outputRejected.flatMap((entry) => entry.subjects),
      ),
    );
  }

  return {
    periods: computation.periods,
    terminal: computation.terminal,
    enterpriseValue: computation.enterpriseValue,
    equityValue: computation.equityValue,
    valuePerShare: computation.valuePerShare,
    terminalValueShare: computation.terminalValueShare,
    checks: [...inputChecks, ...outputChecks],
  };
}

/** `null` cuando el snapshot no declara escenarios. */
export function valueScenarios(
  input: ValuationInput,
  base: Pick<FcffComputation, "valuePerShare">,
): ScenarioValuation | null {
  if (input.scenarios === null) {
    return null;
  }

  const [bear, bull] = SCENARIO_KEYS.map((key) =>
    valueScenario(input, key),
  ) as [ScenarioOutcome, ScenarioOutcome];

  return {
    version: SCENARIO_SET_VERSION,
    bear,
    bull,
    orderCheck: checkScenarioOrder({
      bear: bear.valuePerShare,
      base: base.valuePerShare,
      bull: bull.valuePerShare,
    }),
  };
}
