import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { ArgentinaIndicatorRepository } from "@/modules/macro-series/application/argentina-indicator-repository";
import {
  argentinaIndicatorSchema,
  argentinaIndicatorVintageSchema,
  type ArgentinaIndicatorVintage,
} from "@/modules/macro-series/domain/argentina-indicator";
import type { ArgentinaDefinitionVersion } from "@/modules/macro-series/domain/plan-argentina-indicator";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
const LOCK_NAMESPACE = 20_569;
/** Rows per insert: nine parameters each, far below PostgreSQL's 65,535. */
const INSERT_BATCH = 1000;

function toDefinition(
  row: typeof schema.argentinaIndicatorDefinitions.$inferSelect,
): ArgentinaDefinitionVersion {
  return {
    indicatorId: row.indicatorId,
    revision: row.revision,
    definition: argentinaIndicatorSchema.parse(row.definition),
    contentHash: row.contentHash,
    availableAt: row.availableAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    sourceRunId: row.ingestionRunId,
  };
}

function toObservation(row: {
  observation: typeof schema.argentinaIndicatorObservations.$inferSelect;
  recordedAt: Date;
  segment: string;
}): ArgentinaIndicatorVintage {
  return argentinaIndicatorVintageSchema.parse({
    indicatorId: row.observation.indicatorId,
    periodOn: row.observation.periodOn,
    revision: row.observation.revision,
    value: row.observation.value,
    missingReason: row.observation.missingReason,
    sourceNote: row.observation.sourceNote,
    availableAt: row.observation.availableAt.toISOString(),
    supersededAt: row.observation.supersededAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    segment: row.segment,
    sourceRunId: row.observation.ingestionRunId,
  });
}

/** Atomic revision publication with a source-level advisory lock. */
export function createPostgresArgentinaIndicatorRepository(
  database: Database,
): ArgentinaIndicatorRepository {
  /**
   * Observations first, definitions second: a definition commits with or
   * before its first observation, so every row read here finds the version
   * that describes it even while a run is publishing.
   */
  async function observations(
    indicatorIds: readonly string[],
    openOnly: boolean,
  ): Promise<Map<string, ArgentinaIndicatorVintage[]>> {
    const result = new Map<string, ArgentinaIndicatorVintage[]>(
      indicatorIds.map((id) => [id, []]),
    );
    if (indicatorIds.length === 0) return result;
    const rows = await database
      .select({
        observation: schema.argentinaIndicatorObservations,
        recordedAt: schema.ingestionRuns.recordedAt,
      })
      .from(schema.argentinaIndicatorObservations)
      .innerJoin(
        schema.ingestionRuns,
        eq(
          schema.ingestionRuns.runId,
          schema.argentinaIndicatorObservations.ingestionRunId,
        ),
      )
      .where(
        and(
          inArray(schema.argentinaIndicatorObservations.indicatorId, [
            ...indicatorIds,
          ]),
          openOnly
            ? isNull(schema.argentinaIndicatorObservations.supersededAt)
            : undefined,
        ),
      )
      .orderBy(
        asc(schema.argentinaIndicatorObservations.indicatorId),
        asc(schema.argentinaIndicatorObservations.periodOn),
        asc(schema.argentinaIndicatorObservations.revision),
      );
    const definitionRows = await database
      .select()
      .from(schema.argentinaIndicatorDefinitions)
      .where(
        inArray(schema.argentinaIndicatorDefinitions.indicatorId, [
          ...indicatorIds,
        ]),
      );
    const segmentAt = (indicatorId: string, availableAt: Date) => {
      const candidates = definitionRows.filter(
        (row) =>
          row.indicatorId === indicatorId &&
          row.availableAt <= availableAt &&
          (row.supersededAt === null || availableAt < row.supersededAt),
      );
      if (candidates.length !== 1)
        throw new Error("definition_revision_conflict");
      return argentinaIndicatorSchema.parse(candidates[0]!.definition).segment;
    };
    for (const row of rows) {
      result.get(row.observation.indicatorId)!.push(
        toObservation({
          ...row,
          segment: segmentAt(
            row.observation.indicatorId,
            row.observation.availableAt,
          ),
        }),
      );
    }
    return result;
  }

  return {
    storage: "personal-postgres",
    async currentDefinition(indicatorId) {
      const rows = await database
        .select()
        .from(schema.argentinaIndicatorDefinitions)
        .where(
          and(
            eq(schema.argentinaIndicatorDefinitions.indicatorId, indicatorId),
            isNull(schema.argentinaIndicatorDefinitions.supersededAt),
          ),
        );
      if (rows.length > 1) throw new Error("definition_revision_conflict");
      return rows[0] ? toDefinition(rows[0]) : null;
    },
    openObservations: async (indicatorId) =>
      (await observations([indicatorId], true)).get(indicatorId)!,
    allObservations: async (indicatorId) =>
      (await observations([indicatorId], false)).get(indicatorId)!,
    allObservationsOf: (indicatorIds) => observations(indicatorIds, false),
    async apply(plan, indicatorId) {
      if (plan.guard.refused) throw new Error("mass_change_refused");
      await database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, hashtext(${indicatorId}::text))`,
        );
        if (plan.definition) {
          const next = plan.definition;
          if (next.indicatorId !== indicatorId)
            throw new Error("definition_indicator_mismatch");
          if (next.revision > 0) {
            const closed = await tx
              .update(schema.argentinaIndicatorDefinitions)
              .set({ supersededAt: new Date(next.availableAt) })
              .where(
                and(
                  eq(
                    schema.argentinaIndicatorDefinitions.indicatorId,
                    indicatorId,
                  ),
                  eq(
                    schema.argentinaIndicatorDefinitions.revision,
                    next.revision - 1,
                  ),
                  isNull(schema.argentinaIndicatorDefinitions.supersededAt),
                ),
              )
              .returning({
                revision: schema.argentinaIndicatorDefinitions.revision,
              });
            if (closed.length !== 1)
              throw new Error("definition_changed_during_apply");
          }
          await tx.insert(schema.argentinaIndicatorDefinitions).values({
            indicatorId,
            revision: next.revision,
            definition: next.definition,
            contentHash: next.contentHash,
            availableAt: new Date(next.availableAt),
            supersededAt: null,
            ingestionRunId: next.sourceRunId,
          });
        }
        // Revisions close their predecessor one by one, so a stale plan fails
        // by name; the inserts then go in batches: a first load is thousands
        // of rows and one round trip each made it minutes long against Neon.
        for (const observation of plan.observations) {
          if (observation.indicatorId !== indicatorId)
            throw new Error("observation_indicator_mismatch");
          if (observation.revision === 0) continue;
          const closed = await tx
            .update(schema.argentinaIndicatorObservations)
            .set({ supersededAt: new Date(observation.availableAt) })
            .where(
              and(
                eq(
                  schema.argentinaIndicatorObservations.indicatorId,
                  indicatorId,
                ),
                eq(
                  schema.argentinaIndicatorObservations.periodOn,
                  observation.periodOn,
                ),
                eq(
                  schema.argentinaIndicatorObservations.revision,
                  observation.revision - 1,
                ),
                isNull(schema.argentinaIndicatorObservations.supersededAt),
              ),
            )
            .returning({
              revision: schema.argentinaIndicatorObservations.revision,
            });
          if (closed.length !== 1)
            throw new Error("observation_changed_during_apply");
        }
        for (
          let start = 0;
          start < plan.observations.length;
          start += INSERT_BATCH
        ) {
          await tx.insert(schema.argentinaIndicatorObservations).values(
            plan.observations
              .slice(start, start + INSERT_BATCH)
              .map((observation) => ({
                indicatorId,
                periodOn: observation.periodOn,
                revision: observation.revision,
                value: observation.value,
                missingReason: observation.missingReason,
                sourceNote: observation.sourceNote,
                availableAt: new Date(observation.availableAt),
                supersededAt: null,
                ingestionRunId: observation.sourceRunId,
              })),
          );
        }
      });
    },
  };
}
