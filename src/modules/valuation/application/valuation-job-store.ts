import type {
  ValuationJob,
  ValuationJobOutcome,
} from "../domain/valuation-job";

/**
 * Almacén de la corrida por ticker
 * ([ADR 0045](../../../../docs/architecture/adr/0045-ticker-valuation-job.md)).
 *
 * El índice único de ticker abierto vive en los dos almacenes: insertar el
 * segundo es un conflicto, no un duplicado silencioso.
 */
export class ValuationJobConflictError extends Error {
  constructor() {
    super("An open valuation job already exists for this ticker.");
    this.name = "ValuationJobConflictError";
  }
}

export type ValuationJobClaim = {
  readonly jobId: string;
  readonly startedAt: string;
  readonly claimToken: string;
  readonly staleBefore: string;
};

export type ValuationJobFinish = {
  readonly jobId: string;
  readonly claimToken: string;
  readonly finishedAt: string;
  readonly outcome: ValuationJobOutcome;
};

export interface ValuationJobStore {
  findOpenByTicker(ticker: string): Promise<ValuationJob | null>;
  findLatestByTicker(ticker: string): Promise<ValuationJob | null>;
  insert(job: ValuationJob): Promise<ValuationJob>;
  /**
   * Reclama la fila si sigue en cola o si su arranque ya es viejo. `null` si
   * otro worker la tiene fresca o si ya no existe.
   */
  claim(claim: ValuationJobClaim): Promise<ValuationJob | null>;
  /**
   * Cierra la fila sólo con el token del reclamo. `lost` si otro worker ya la
   * tomó o la cerró.
   */
  finish(finish: ValuationJobFinish): Promise<"completed" | "lost">;
}
