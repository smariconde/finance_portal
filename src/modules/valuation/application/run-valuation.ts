import { computeFcff } from "../domain/fcff";
import {
  assertNoRejections,
  checkValuationInput,
  checkValuationOutput,
  failedChecks,
  type PolicyCheck,
} from "../domain/policy-checks";
import { buildSensitivityGrid } from "../domain/sensitivity";
import { isValuationPolicyError } from "../domain/valuation-error";
import {
  assertMethodSupported,
  computeValuationInputHash,
  valuationInputSchema,
  type ValuationInput,
} from "../domain/valuation-input";
import {
  collectValuationProvenance,
  computeValuationResultHash,
  valuationRunSchema,
  valuationResultSchema,
  type ValuationRun,
} from "../domain/valuation-run";

/**
 * Orquestador de una corrida de valuación.
 *
 * No abre red, no consulta un repositorio, no invoca IA y no lee el reloj del
 * proceso: recibe el snapshot completo y sus dependencias explícitas. Recalcular
 * con el mismo input canónico produce el mismo `input_hash`, el mismo
 * `result_hash` y el mismo resultado.
 *
 * Un rechazo de policy **no** lanza: devuelve una corrida `rejected` con su
 * motivo, porque explicar por qué un valor no se calculó también es audit trail
 * (`TM-16`). Sólo un snapshot estructuralmente inválido falla, y lo hace en Zod.
 */
export type RunValuationDependencies = {
  now: () => string;
  newValuationRunId: () => string;
};

export function runValuation(
  candidate: ValuationInput,
  dependencies: RunValuationDependencies,
): ValuationRun {
  const input = valuationInputSchema.parse(candidate);
  const inputHash = computeValuationInputHash(input);
  const startedAt = dependencies.now();

  const identity = {
    valuationRunId: dependencies.newValuationRunId(),
    subject: input.subject,
    asOf: input.asOf,
    currency: input.currency,
    assetProfile: input.assetProfile,
    method: input.method,
    engineVersion: input.engineVersion,
    methodologyVersion: input.methodologyVersion,
    decimalPolicy: input.decimalPolicy,
    inputHash,
    input,
    provenance: collectValuationProvenance(input),
  };

  try {
    assertMethodSupported(input);

    const inputChecks = checkValuationInput(input);
    assertNoRejections(inputChecks);

    const computation = computeFcff(input);
    const outputChecks = checkValuationOutput(computation);
    assertNoRejections(outputChecks);

    const checks: PolicyCheck[] = [...inputChecks, ...outputChecks];
    const result = valuationResultSchema.parse({
      periods: computation.periods,
      terminal: computation.terminal,
      enterpriseValue: computation.enterpriseValue,
      bridgeComponents: computation.bridgeComponents,
      equityValue: computation.equityValue,
      dilutedShares: computation.dilutedShares,
      valuePerShare: computation.valuePerShare,
      terminalValueShare: computation.terminalValueShare,
      sensitivity:
        input.sensitivity === null ? null : buildSensitivityGrid(input),
      checks,
    });

    const finishedAt = dependencies.now();

    return valuationRunSchema.parse({
      ...identity,
      // Una revisión pendiente no se esconde detrás de un número calculado.
      status:
        failedChecks(checks, "require_review").length > 0
          ? "requires_review"
          : "computed",
      resultHash: computeValuationResultHash({
        inputHash,
        engineVersion: input.engineVersion,
        methodologyVersion: input.methodologyVersion,
        result,
      }),
      result,
      failure: null,
      startedAt,
      finishedAt,
      recordedAt: finishedAt,
    });
  } catch (error) {
    if (!isValuationPolicyError(error)) {
      throw error;
    }

    const finishedAt = dependencies.now();

    return valuationRunSchema.parse({
      ...identity,
      status: "rejected",
      resultHash: null,
      result: null,
      failure: {
        code: error.code,
        // El mensaje del motor sólo nombra reglas y rutas de campo (`TM-02`).
        message: error.message.slice(0, 240),
        subjects: error.subjects,
      },
      startedAt,
      finishedAt,
      recordedAt: finishedAt,
    });
  }
}
