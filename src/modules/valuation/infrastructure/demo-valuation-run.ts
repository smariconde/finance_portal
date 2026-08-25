import { runValuation } from "../application/run-valuation";
import type { ValuationRun } from "../domain/valuation-run";

import {
  DEMO_VALUATION_INPUT,
  DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
} from "./demo-valuation-fixtures";

/**
 * Corridas demo de `FixtureCo`, calculadas con reloj e identificador fijos.
 *
 * El motor recibe sus dependencias por inyección justamente para esto: una
 * superficie que leyera `Date.now()` o generara un UUID en cada render
 * produciría una corrida distinta por request, y la promesa del slice es que el
 * mismo snapshot devuelve el mismo resultado y el mismo hash. Con reloj fijo la
 * página es estática, reproducible y comparable entre builds.
 *
 * No abre red, no consulta un repositorio y no persiste: renderizar una corrida
 * no la registra. La persistencia append-only vive en `valuation_runs` y sólo
 * la escribe el modo personal.
 */
export const DEMO_VALUATION_RUN_IDS = Object.freeze({
  current: "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c401",
  beforeAmendment: "6f2a1c58-0d94-4d1b-9c3f-2b7a5e10c402",
});

/** Momento en que la fixture fija su corrida; no es la hora del proceso. */
export const DEMO_VALUATION_RUN_AT = "2026-08-24T12:00:00.000Z";

function buildRun(
  input: typeof DEMO_VALUATION_INPUT,
  valuationRunId: string,
): ValuationRun {
  return runValuation(input, {
    now: () => DEMO_VALUATION_RUN_AT,
    newValuationRunId: () => valuationRunId,
  });
}

/** Corrida vigente: revenue FY2024 enmendado, `as_known(2025-06-01)`. */
export function buildDemoValuationRun(): ValuationRun {
  return buildRun(DEMO_VALUATION_INPUT, DEMO_VALUATION_RUN_IDS.current);
}

/**
 * El mismo modelo leído con el corte anterior a la enmienda. Existe para que la
 * superficie pueda mostrar que dos cortes de conocimiento son **dos corridas**
 * con dos hashes, no un recálculo de la misma (`TM-06`).
 */
export function buildDemoValuationRunBeforeAmendment(): ValuationRun {
  return buildRun(
    DEMO_VALUATION_INPUT_BEFORE_AMENDMENT,
    DEMO_VALUATION_RUN_IDS.beforeAmendment,
  );
}
