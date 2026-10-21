import {
  assertStoredMarketExpectations,
  type MarketExpectationsRepository,
  type StoredMarketExpectations,
} from "../application/market-expectations-repository";
import {
  marketExpectationsEvidenceSchema,
  marketExpectationsRecordSchema,
} from "../domain/market-expectations";

/**
 * Doble en memoria del repositorio de lecturas de expectativas. Sostiene las
 * mismas reglas que el personal para que el contrato corra igual sobre los
 * dos. Ninguna raíz de composición lo construye.
 */
export function createInMemoryMarketExpectationsRepository(): MarketExpectationsRepository {
  const readings: StoredMarketExpectations[] = [];
  const newestFirst = (
    left: StoredMarketExpectations,
    right: StoredMarketExpectations,
  ) => right.record.proposedAt.localeCompare(left.record.proposedAt);

  return {
    storage: "in-memory-fixture",
    async record(stored) {
      const parsed: StoredMarketExpectations = {
        record: marketExpectationsRecordSchema.parse(stored.record),
        evidence: stored.evidence.map((item) =>
          marketExpectationsEvidenceSchema.parse(item),
        ),
      };

      assertStoredMarketExpectations(parsed);

      if (
        readings.some(
          (candidate) => candidate.record.readingId === parsed.record.readingId,
        )
      ) {
        throw new Error(`reading ${parsed.record.readingId} already recorded`);
      }

      readings.push(parsed);
    },
    async latestForSubject(legalEntityId) {
      return (
        readings
          .filter((stored) => stored.record.legalEntityId === legalEntityId)
          .sort(newestFirst)[0] ?? null
      );
    },
    async acceptedForFiscalYear(legalEntityId, fiscalYearEnd) {
      return (
        readings
          .filter(
            (stored) =>
              stored.record.legalEntityId === legalEntityId &&
              stored.record.outcome === "accepted" &&
              stored.record.fiscalYearEnd === fiscalYearEnd,
          )
          .sort(newestFirst)[0] ?? null
      );
    },
  };
}
