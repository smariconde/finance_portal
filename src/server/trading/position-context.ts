import "server-only";

import {
  valuationOf,
  type PositionContext,
} from "@/modules/trading/domain/position-context";
import type { StoredValuationRun } from "@/modules/valuation/domain/stored-valuation-run";
import { valuationTickerSchema } from "@/modules/valuation/domain/valuation-job";
import { getValuationJobStore } from "@/server/persistence/get-valuation-job-store";
import { getValuationRunRepository } from "@/server/persistence/get-valuation-run-repository";

/** Los mismos 20 trabajos que lee el historial de `/valuacion/[ticker]`. */
const VALUATION_JOBS_READ = 20;

/**
 * El cruce de las posiciones con la base de análisis (`position-context-2.0.0`):
 * la última valuación registrada de cada ticker. Nunca escribe ni encola:
 * abrir la cuenta no pide una valuación. Si la base de análisis falla, quien llama recibe el error y lo
 * muestra como «cruce no disponible»; la cuenta ya se leyó por su lado.
 */
export async function loadPositionContext(
  symbols: readonly string[],
): Promise<PositionContext[]> {
  if (symbols.length === 0) return [];

  const jobs = getValuationJobStore();
  const runs = getValuationRunRepository();

  const latestRunOf = async (
    symbol: string,
  ): Promise<{ requested: boolean; run: StoredValuationRun | null }> => {
    // `BRK/B` no es un ticker de valuación: nunca se pudo pedir con ese nombre.
    const ticker = valuationTickerSchema.safeParse(symbol);
    if (!ticker.success) return { requested: false, run: null };
    const completed = await jobs.listCompletedByTicker(
      ticker.data,
      VALUATION_JOBS_READ,
    );
    const recorded = completed.find((job) => job.valuationRunId !== null);
    return {
      requested: completed.length > 0,
      run:
        recorded === undefined
          ? null
          : await runs.findById(recorded.valuationRunId!),
    };
  };

  const valuations = await Promise.all(symbols.map(latestRunOf));
  return symbols.map((symbol, index) => {
    const { requested, run } = valuations[index]!;
    return { symbol, valuation: valuationOf(run, requested) };
  });
}
