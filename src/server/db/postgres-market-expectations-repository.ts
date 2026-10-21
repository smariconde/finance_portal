import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  assertStoredMarketExpectations,
  type MarketExpectationsRepository,
  type StoredMarketExpectations,
} from "@/modules/valuation/application/market-expectations-repository";
import {
  marketExpectationsEvidenceSchema,
  marketExpectationsRecordSchema,
} from "@/modules/valuation/domain/market-expectations";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ReadingRow = typeof schema.marketExpectationsReadings.$inferSelect;

/** Repositorio personal de lecturas de expectativas (`F6-11`). */
export function createPostgresMarketExpectationsRepository(
  database: Database,
): MarketExpectationsRepository {
  async function hydrate(row: ReadingRow): Promise<StoredMarketExpectations> {
    const evidence = await database
      .select()
      .from(schema.marketExpectationsEvidence)
      .where(eq(schema.marketExpectationsEvidence.readingId, row.readingId))
      .orderBy(asc(schema.marketExpectationsEvidence.evidenceId));

    return {
      record: marketExpectationsRecordSchema.parse({
        ...row,
        proposedAt: row.proposedAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
      }),
      evidence: evidence.map((item) =>
        marketExpectationsEvidenceSchema.parse({
          evidenceId: item.evidenceId,
          sourceId: item.sourceId,
          section: item.section,
          documentUrl: item.documentUrl,
          accessionNumber: item.accessionNumber,
          documentAcceptedAt: item.documentAcceptedAt.toISOString(),
          sha256: item.sha256,
          byteLength: item.byteLength,
          truncated: item.truncated,
          excerpt: item.excerpt,
        }),
      ),
    };
  }

  return {
    storage: "personal-postgres",
    async record(stored) {
      const record = marketExpectationsRecordSchema.parse(stored.record);
      const evidence = stored.evidence.map((item) =>
        marketExpectationsEvidenceSchema.parse(item),
      );

      assertStoredMarketExpectations({ record, evidence });

      await database.transaction(async (tx) => {
        await tx.insert(schema.marketExpectationsReadings).values({
          ...record,
          proposedAt: new Date(record.proposedAt),
          recordedAt: new Date(record.recordedAt),
        });
        await tx.insert(schema.marketExpectationsEvidence).values(
          evidence.map((item) => ({
            ...item,
            readingId: record.readingId,
            documentAcceptedAt: new Date(item.documentAcceptedAt),
          })),
        );
      });
    },
    async latestForSubject(legalEntityId) {
      const [row] = await database
        .select()
        .from(schema.marketExpectationsReadings)
        .where(
          eq(schema.marketExpectationsReadings.legalEntityId, legalEntityId),
        )
        .orderBy(desc(schema.marketExpectationsReadings.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
    async acceptedForFiscalYear(legalEntityId, fiscalYearEnd) {
      const [row] = await database
        .select()
        .from(schema.marketExpectationsReadings)
        .where(
          and(
            eq(schema.marketExpectationsReadings.legalEntityId, legalEntityId),
            eq(schema.marketExpectationsReadings.outcome, "accepted"),
            eq(schema.marketExpectationsReadings.fiscalYearEnd, fiscalYearEnd),
          ),
        )
        .orderBy(desc(schema.marketExpectationsReadings.proposedAt))
        .limit(1);

      return row === undefined ? null : hydrate(row);
    },
  };
}
