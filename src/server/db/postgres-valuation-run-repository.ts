import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  toReplayKey,
  valuationReplayKeySchema,
  valuationRunListQuerySchema,
  type ValuationReplayKey,
  type ValuationRunRepository,
} from "@/modules/valuation/application/valuation-run-repository";
import {
  valuationRunSchema,
  type ValuationRun,
} from "@/modules/valuation/domain/valuation-run";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ValuationRunRow = typeof schema.valuationRuns.$inferSelect;

function toDomainRun(row: ValuationRunRow): ValuationRun {
  return valuationRunSchema.parse({
    valuationRunId: row.valuationRunId,
    subject: {
      legalEntityId: row.legalEntityId,
      securityId: row.securityId,
      listingId: row.listingId,
      depositaryProgramId: row.depositaryProgramId,
    },
    asOf: row.asOf,
    currency: row.currency,
    assetProfile: row.assetProfile,
    method: row.method,
    engineVersion: row.engineVersion,
    methodologyVersion: row.methodologyVersion,
    decimalPolicy: {
      precision: row.decimalPrecision,
      rounding: row.decimalRounding,
    },
    status: row.status,
    inputHash: row.inputHash,
    resultHash: row.resultHash,
    input: row.input,
    result: row.result,
    failure:
      row.failureCode === null
        ? null
        : {
            code: row.failureCode,
            message: row.failureMessage,
            subjects: row.failureSubjects,
          },
    provenance: {
      sourceIds: row.sourceIds,
      observationIds: row.observationIds,
      knowledge: (row.input as { knowledge: unknown }).knowledge,
    },
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
}

function toRow(run: ValuationRun): typeof schema.valuationRuns.$inferInsert {
  return {
    valuationRunId: run.valuationRunId,
    legalEntityId: run.subject.legalEntityId,
    securityId: run.subject.securityId,
    listingId: run.subject.listingId,
    depositaryProgramId: run.subject.depositaryProgramId,
    asOf: run.asOf,
    currency: run.currency,
    assetProfile: run.assetProfile,
    method: run.method,
    engineVersion: run.engineVersion,
    methodologyVersion: run.methodologyVersion,
    decimalPrecision: run.decimalPolicy.precision,
    decimalRounding: run.decimalPolicy.rounding,
    status: run.status,
    inputHash: run.inputHash,
    resultHash: run.resultHash,
    input: run.input,
    result: run.result,
    failureCode: run.failure?.code ?? null,
    failureMessage: run.failure?.message ?? null,
    failureSubjects: [...(run.failure?.subjects ?? [])],
    sourceIds: [...run.provenance.sourceIds],
    observationIds: [...run.provenance.observationIds],
    startedAt: new Date(run.startedAt),
    finishedAt: new Date(run.finishedAt),
    recordedAt: new Date(run.recordedAt),
  };
}

export function createPostgresValuationRunRepository(
  database: Database,
): ValuationRunRepository {
  async function findRow(
    key: ValuationReplayKey,
  ): Promise<ValuationRunRow | null> {
    const [row] = await database
      .select()
      .from(schema.valuationRuns)
      .where(
        and(
          eq(schema.valuationRuns.inputHash, key.inputHash),
          eq(schema.valuationRuns.engineVersion, key.engineVersion),
          eq(schema.valuationRuns.methodologyVersion, key.methodologyVersion),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  return {
    storage: "personal-postgres",
    async record(candidate) {
      const run = valuationRunSchema.parse(candidate);
      const key = toReplayKey(run);

      // Append-only: el conflicto sobre la clave de replay no sobrescribe la
      // corrida existente, la devuelve. Recalcular un snapshot determinista no
      // puede producir otro resultado, así que duplicar la fila sólo agregaría
      // ruido al audit trail.
      const [inserted] = await database
        .insert(schema.valuationRuns)
        .values(toRow(run))
        .onConflictDoNothing({
          target: [
            schema.valuationRuns.inputHash,
            schema.valuationRuns.engineVersion,
            schema.valuationRuns.methodologyVersion,
          ],
        })
        .returning();

      if (inserted !== undefined) {
        return toDomainRun(inserted);
      }

      const existing = await findRow(key);

      if (existing === null) {
        throw new Error(
          "The valuation run conflicted on replay but could not be read back.",
        );
      }

      return toDomainRun(existing);
    },
    async findByReplayKey(key) {
      const row = await findRow(valuationReplayKeySchema.parse(key));

      return row === null ? null : toDomainRun(row);
    },
    async list(query) {
      const parsedQuery = valuationRunListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.valuationRuns)
        .where(
          and(
            eq(schema.valuationRuns.legalEntityId, parsedQuery.legalEntityId),
            parsedQuery.securityId === undefined
              ? undefined
              : eq(schema.valuationRuns.securityId, parsedQuery.securityId),
          ),
        )
        .orderBy(desc(schema.valuationRuns.recordedAt))
        .limit(parsedQuery.limit);

      return rows.map(toDomainRun);
    },
  };
}
