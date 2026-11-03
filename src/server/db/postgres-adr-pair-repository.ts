import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  MAX_LEG_CLOSES_PER_READ,
  type AdrPairRepository,
} from "@/modules/implied-fx/application/adr-pair-repository";
import {
  adrLegCloseSchema,
  type AdrLegClose,
} from "@/modules/implied-fx/domain/declared-adr-pairs";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

const INSERT_CHUNK = 500;

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }

  return batches;
}

/** Cierres crudos de las patas ADR (ADR 0068). Misma regla que `benchmark_prices`. */
export function createPostgresAdrPairRepository(
  database: Database,
): AdrPairRepository {
  return {
    async writeLegCloses(closes, ingestionRunId) {
      const legId = closes[0]?.legId ?? "";

      return database.transaction(async (tx) => {
        const stored = new Map(
          (
            await tx
              .select({
                marketDate: schema.adrPairCloses.marketDate,
                close: schema.adrPairCloses.close,
              })
              .from(schema.adrPairCloses)
              .where(eq(schema.adrPairCloses.legId, legId))
          ).map((row) => [row.marketDate, row.close]),
        );

        const fresh: AdrLegClose[] = [];
        const closesConflicting: string[] = [];
        let closesDuplicate = 0;

        for (const close of closes) {
          const existing = stored.get(close.marketDate);

          if (existing === undefined) {
            fresh.push(close);
          } else if (Number(existing) === Number(close.close)) {
            closesDuplicate += 1;
          } else {
            closesConflicting.push(close.marketDate);
          }
        }

        for (const batch of chunk(fresh, INSERT_CHUNK)) {
          await tx
            .insert(schema.adrPairCloses)
            .values(
              batch.map((close) => ({
                legId: close.legId,
                marketDate: close.marketDate,
                close: close.close,
                currency: close.currency,
                ingestionRunId,
              })),
            )
            .onConflictDoNothing();
        }

        return {
          legId,
          closesInserted: fresh.length,
          closesDuplicate,
          closesConflicting,
        };
      });
    },

    async listLegCloses(legIds, untilOn) {
      if (legIds.length === 0) {
        return [];
      }

      const rows = await database
        .select({
          legId: schema.adrPairCloses.legId,
          marketDate: schema.adrPairCloses.marketDate,
          close: schema.adrPairCloses.close,
          currency: schema.adrPairCloses.currency,
          recordedAt: schema.ingestionRuns.recordedAt,
        })
        .from(schema.adrPairCloses)
        .innerJoin(
          schema.ingestionRuns,
          eq(schema.ingestionRuns.runId, schema.adrPairCloses.ingestionRunId),
        )
        .where(
          and(
            inArray(schema.adrPairCloses.legId, [...legIds]),
            lte(schema.adrPairCloses.marketDate, untilOn),
          ),
        )
        .orderBy(asc(schema.adrPairCloses.marketDate))
        .limit(MAX_LEG_CLOSES_PER_READ + 1);

      if (rows.length > MAX_LEG_CLOSES_PER_READ) {
        throw new Error(
          `adr pair read exceeded its limit of ${MAX_LEG_CLOSES_PER_READ} closes`,
        );
      }

      return rows.map((row) => ({
        ...adrLegCloseSchema.parse({
          legId: row.legId,
          marketDate: row.marketDate,
          close: row.close,
          currency: row.currency,
        }),
        recordedAt: new Date(row.recordedAt).toISOString(),
      }));
    },
  };
}
