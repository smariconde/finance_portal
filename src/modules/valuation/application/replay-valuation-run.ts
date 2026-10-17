import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";

import { runValuation } from "./run-valuation";

/**
 * Replay de una corrida persistida (`F5-06`): vuelve a calcular **desde su
 * snapshot** y compara los dos hashes con los guardados.
 *
 * No recibe dependencias porque no necesita ninguna: el snapshot trae los
 * hechos con su provenance, los componentes fechados del costo de capital y las
 * decisiones cualitativas —la propuesta de la IA incluida—. No abre red, no lee
 * las tablas de propuestas y no puede llamar a un modelo. El reloj y el ID son
 * los de la corrida, así que lo único que puede diferir es lo que importa.
 */
export const VALUATION_REPLAY_VERSION = "valuation-replay-1.0.0";

export type ValuationReplayDivergence = "input_hash" | "result_hash" | "status";

export type ValuationReplay = {
  readonly version: typeof VALUATION_REPLAY_VERSION;
  readonly valuationRunId: string;
  readonly outcome: "reproduced" | "diverged";
  readonly divergences: readonly ValuationReplayDivergence[];
  readonly recorded: ReplayFingerprint;
  readonly replayed: ReplayFingerprint;
};

type ReplayFingerprint = {
  readonly status: ValuationRun["status"];
  readonly inputHash: string;
  readonly resultHash: string | null;
};

function fingerprint(run: ValuationRun): ReplayFingerprint {
  return {
    status: run.status,
    inputHash: run.inputHash,
    resultHash: run.resultHash,
  };
}

export function replayValuationRun(candidate: ValuationRun): ValuationReplay {
  const recorded = valuationRunSchema.parse(candidate);
  const replayed = runValuation(recorded.input, {
    now: () => recorded.startedAt,
    newValuationRunId: () => recorded.valuationRunId,
  });

  const divergences: ValuationReplayDivergence[] = [];

  if (replayed.inputHash !== recorded.inputHash) divergences.push("input_hash");
  if (replayed.resultHash !== recorded.resultHash) {
    divergences.push("result_hash");
  }
  if (replayed.status !== recorded.status) divergences.push("status");

  return {
    version: VALUATION_REPLAY_VERSION,
    valuationRunId: recorded.valuationRunId,
    outcome: divergences.length === 0 ? "reproduced" : "diverged",
    divergences,
    recorded: fingerprint(recorded),
    replayed: fingerprint(replayed),
  };
}
