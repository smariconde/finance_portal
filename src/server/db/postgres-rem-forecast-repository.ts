import "server-only";

import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import type { RemForecastRepository } from "@/modules/macro-series/application/rem-forecast-repository";
import { BCRA_REM_SOURCE_PARSER_VERSION } from "@/modules/macro-series/application/live-bcra-rem-release";
import type { RemForecastVintage } from "@/modules/macro-series/domain/plan-rem-release";
import { planRemRelease } from "@/modules/macro-series/domain/plan-rem-release";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type Row = typeof schema.remInflationForecasts.$inferSelect;
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
const first = (month: string) => `${monthSchema.parse(month)}-01`;

function toVintage(row: {
  forecast: Row;
  recordedAt: Date;
}): RemForecastVintage {
  const forecast = row.forecast;
  return {
    roundMonth: forecast.roundMonth.slice(0, 7),
    targetMonth: forecast.targetMonth.slice(0, 7),
    revision: forecast.revision,
    medianPercent: forecast.medianPercent,
    publishedOn: forecast.publishedOn,
    availableAt: forecast.availableAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    supersededAt: forecast.supersededAt?.toISOString() ?? null,
    sourceRunId: forecast.ingestionRunId,
  };
}

/** Private PostgreSQL repository; no historical read uses the open-row index. */
export function createPostgresRemForecastRepository(
  database: Database,
): RemForecastRepository {
  const forecast = schema.remInflationForecasts;
  return {
    storage: "personal-postgres",
    async open(roundMonth) {
      const rows = await database
        .select({ forecast, recordedAt: schema.ingestionRuns.recordedAt })
        .from(forecast)
        .innerJoin(
          schema.ingestionRuns,
          eq(schema.ingestionRuns.runId, forecast.ingestionRunId),
        )
        .where(
          and(
            eq(forecast.roundMonth, first(roundMonth)),
            isNull(forecast.supersededAt),
          ),
        )
        .orderBy(asc(forecast.targetMonth));
      return rows.map(toVintage);
    },
    async asKnown(input) {
      z.iso.datetime({ offset: true }).parse(input.knownAt);
      const rows = await database
        .select({ forecast, recordedAt: schema.ingestionRuns.recordedAt })
        .from(forecast)
        .innerJoin(
          schema.ingestionRuns,
          eq(schema.ingestionRuns.runId, forecast.ingestionRunId),
        )
        .where(
          and(
            eq(forecast.targetMonth, first(input.targetMonth)),
            lte(forecast.availableAt, new Date(input.knownAt)),
            input.knowledgeBasis === "system_recorded"
              ? lte(schema.ingestionRuns.recordedAt, new Date(input.knownAt))
              : undefined,
          ),
        )
        .orderBy(desc(forecast.roundMonth), desc(forecast.revision));
      const latest = new Map<string, RemForecastVintage>();
      for (const row of rows) {
        const vintage = toVintage(row);
        if (!latest.has(vintage.roundMonth))
          latest.set(vintage.roundMonth, vintage);
      }
      return [...latest.values()];
    },
    async latestRoundAsKnown(input) {
      z.iso.datetime({ offset: true }).parse(input.knownAt);
      const rows = await database
        .select({ forecast, recordedAt: schema.ingestionRuns.recordedAt })
        .from(forecast)
        .innerJoin(
          schema.ingestionRuns,
          eq(schema.ingestionRuns.runId, forecast.ingestionRunId),
        )
        .where(
          and(
            lte(forecast.availableAt, new Date(input.knownAt)),
            input.knowledgeBasis === "system_recorded"
              ? lte(schema.ingestionRuns.recordedAt, new Date(input.knownAt))
              : undefined,
            sql`${forecast.roundMonth} = (
            select max(f.round_month)
            from rem_inflation_forecasts f
            join ingestion_runs r on r.run_id = f.ingestion_run_id
            where f.available_at <= ${input.knownAt}::timestamptz
              and (${input.knowledgeBasis} = 'public_availability'
                or r.recorded_at <= ${input.knownAt}::timestamptz)
          )`,
          ),
        )
        .orderBy(
          desc(forecast.roundMonth),
          asc(forecast.targetMonth),
          desc(forecast.revision),
        );
      if (rows.length === 0) return [];
      const targets = new Map<string, RemForecastVintage>();
      for (const row of rows) {
        const vintage = toVintage(row);
        if (!targets.has(vintage.targetMonth))
          targets.set(vintage.targetMonth, vintage);
      }
      return [...targets.values()];
    },
    async publish({ release, runId, startedAt }) {
      z.uuid().parse(runId);
      z.iso.datetime({ offset: true }).parse(startedAt);
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(20570, hashtext(${release.roundMonth}))`,
        );
        const oldRows = await tx
          .select({ forecast, recordedAt: schema.ingestionRuns.recordedAt })
          .from(forecast)
          .innerJoin(
            schema.ingestionRuns,
            eq(schema.ingestionRuns.runId, forecast.ingestionRunId),
          )
          .where(
            and(
              eq(forecast.roundMonth, first(release.roundMonth)),
              isNull(forecast.supersededAt),
            ),
          )
          .orderBy(asc(forecast.targetMonth));
        const old = oldRows.map(toVintage);
        const plan = planRemRelease({
          ...release,
          runId,
          open: old,
        });
        const status = plan.observations.length > 0 ? "succeeded" : "duplicate";
        const contentHash = computeContentHash({
          roundMonth: release.roundMonth,
          publishedOn: release.publishedOn,
          forecasts: release.forecasts,
        });
        const idempotencyKey = computeContentHash({
          contentHash,
          replaces: old.map((row) => [row.targetMonth, row.revision]),
        });
        await tx.insert(schema.ingestionRuns).values({
          runId,
          sourceId: "bcra-rem-release",
          datasetId: "bcra.rem-monthly-inflation",
          parserVersion: BCRA_REM_SOURCE_PARSER_VERSION,
          idempotencyKey,
          requestedAsOf: `${release.roundMonth}-01`,
          requestedVintage: release.publishedOn,
          cursor: null,
          nextCursor: null,
          subjectKey: release.roundMonth,
          selectionVersion: "rem-release-monthly-ipc-1.0.0",
          selectionAnchorOn: null,
          status,
          startedAt: new Date(startedAt),
          finishedAt: new Date(release.recordedAt),
          fetchedCount: release.forecasts.length,
          acceptedCount: plan.observations.length,
          rejectedCount: 0,
          duplicateCount: plan.unchanged,
          contentHash,
          failureCode: null,
          failureMessage: null,
          failureRetryable: null,
          qualityFlags: ["publication_page_verified", "workbook_link_verified"],
          replayOfRunId: null,
          recordedAt: new Date(release.recordedAt),
        });
        for (const observation of plan.observations) {
          if (observation.revision > 0) {
            const closed = await tx
              .update(forecast)
              .set({ supersededAt: new Date(observation.availableAt) })
              .where(
                and(
                  eq(forecast.roundMonth, first(observation.roundMonth)),
                  eq(forecast.targetMonth, first(observation.targetMonth)),
                  eq(forecast.revision, observation.revision - 1),
                  isNull(forecast.supersededAt),
                ),
              )
              .returning({ revision: forecast.revision });
            if (closed.length !== 1) throw new Error("rem_revision_race");
          }
          await tx.insert(forecast).values({
            roundMonth: first(observation.roundMonth),
            targetMonth: first(observation.targetMonth),
            revision: observation.revision,
            medianPercent: observation.medianPercent,
            publishedOn: observation.publishedOn,
            availableAt: new Date(observation.availableAt),
            supersededAt: null,
            ingestionRunId: runId,
          });
        }
        return { status, accepted: plan.observations.length };
      });
    },
  };
}
