import type {
  AdrLegWriteSummary,
  AdrPairRepository,
  StoredAdrLegClose,
} from "../application/adr-pair-repository";
import type { AdrLegClose } from "../domain/declared-adr-pairs";

/** Doble de prueba con la misma regla que PostgreSQL: lo distinto se reporta. */
export class InMemoryAdrPairRepository implements AdrPairRepository {
  private readonly rows = new Map<string, StoredAdrLegClose>();

  constructor(private readonly recordedAtOf: (runId: string) => string) {}

  async writeLegCloses(
    closes: readonly AdrLegClose[],
    ingestionRunId: string,
  ): Promise<AdrLegWriteSummary> {
    const legId = closes[0]?.legId ?? "";
    const closesConflicting: string[] = [];
    let closesInserted = 0;
    let closesDuplicate = 0;

    for (const close of closes) {
      const key = `${close.legId}|${close.marketDate}`;
      const existing = this.rows.get(key);

      if (existing === undefined) {
        this.rows.set(key, {
          ...close,
          recordedAt: this.recordedAtOf(ingestionRunId),
        });
        closesInserted += 1;
      } else if (Number(existing.close) === Number(close.close)) {
        closesDuplicate += 1;
      } else {
        closesConflicting.push(close.marketDate);
      }
    }

    return { legId, closesInserted, closesDuplicate, closesConflicting };
  }

  async listLegCloses(
    legIds: readonly string[],
    untilOn: string,
    fromOn?: string,
  ): Promise<readonly StoredAdrLegClose[]> {
    const wanted = new Set(legIds);

    return [...this.rows.values()]
      .filter(
        (row) =>
          wanted.has(row.legId) &&
          row.marketDate <= untilOn &&
          (fromOn === undefined || row.marketDate >= fromOn),
      )
      .sort((left, right) => left.marketDate.localeCompare(right.marketDate));
  }
}
