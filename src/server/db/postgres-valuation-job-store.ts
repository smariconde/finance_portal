import "server-only";

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  ValuationJobConflictError,
  VALUATION_HISTORY_LIMIT,
  type ValuationJobBeat,
  type ValuationJobClaim,
  type ValuationJobFinish,
  type ValuationJobStore,
} from "@/modules/valuation/application/valuation-job-store";
import {
  VALUATION_JOB_RULE_VERSION,
  valuationJobSchema,
  type ValuationJob,
} from "@/modules/valuation/domain/valuation-job";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type ValuationJobRow = typeof schema.valuationJobs.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

function at(instant: string): Date {
  return new Date(instant);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  return "cause" in error && isUniqueViolation(error.cause);
}

function toDomain(row: ValuationJobRow): ValuationJob {
  return valuationJobSchema.parse({
    jobId: row.jobId,
    ticker: row.ticker,
    status: row.status,
    knownAt: iso(row.knownAt),
    ruleVersion: row.ruleVersion,
    identityStatus: row.identityStatus,
    legalEntityId: row.legalEntityId,
    securityId: row.securityId,
    listingId: row.listingId,
    gap: row.gap,
    methodStatus: row.methodStatus,
    assetProfile: row.assetProfile,
    method: row.method,
    rigor: row.rigor,
    unsupportedReason: row.unsupportedReason,
    snapshotGap: row.snapshotGap,
    valuationRunId: row.valuationRunId,
    runStatus: row.runStatus,
    dataStep: row.dataStep,
    qualitativeStep: row.qualitativeStep,
    followsJobId: row.followsJobId,
    claimToken: row.claimToken,
    createdAt: iso(row.createdAt),
    startedAt: row.startedAt === null ? null : iso(row.startedAt),
    heartbeatAt: row.heartbeatAt === null ? null : iso(row.heartbeatAt),
    finishedAt: row.finishedAt === null ? null : iso(row.finishedAt),
  });
}

function toInsert(job: ValuationJob): typeof schema.valuationJobs.$inferInsert {
  return {
    jobId: job.jobId,
    ticker: job.ticker,
    status: job.status,
    knownAt: at(job.knownAt),
    ruleVersion: job.ruleVersion,
    identityStatus: job.identityStatus,
    legalEntityId: job.legalEntityId,
    securityId: job.securityId,
    listingId: job.listingId,
    gap: job.gap,
    methodStatus: job.methodStatus,
    assetProfile: job.assetProfile,
    method: job.method,
    rigor: job.rigor,
    unsupportedReason: job.unsupportedReason,
    snapshotGap: job.snapshotGap,
    valuationRunId: job.valuationRunId,
    runStatus: job.runStatus,
    dataStep: job.dataStep,
    qualitativeStep: job.qualitativeStep,
    followsJobId: job.followsJobId,
    claimToken: job.claimToken,
    createdAt: at(job.createdAt),
    startedAt: job.startedAt === null ? null : at(job.startedAt),
    heartbeatAt: job.heartbeatAt === null ? null : at(job.heartbeatAt),
    finishedAt: job.finishedAt === null ? null : at(job.finishedAt),
  };
}

export function createPostgresValuationJobStore(
  database: Database,
): ValuationJobStore {
  return {
    async findOpenByTicker(ticker) {
      const rows = await database
        .select()
        .from(schema.valuationJobs)
        .where(
          and(
            eq(schema.valuationJobs.ticker, ticker),
            or(
              eq(schema.valuationJobs.status, "queued"),
              eq(schema.valuationJobs.status, "running"),
            ),
          ),
        )
        .limit(1);

      return rows[0] === undefined ? null : toDomain(rows[0]);
    },
    async findLatestByTicker(ticker) {
      const rows = await database
        .select()
        .from(schema.valuationJobs)
        .where(eq(schema.valuationJobs.ticker, ticker))
        .orderBy(desc(schema.valuationJobs.createdAt))
        .limit(1);

      return rows[0] === undefined ? null : toDomain(rows[0]);
    },
    async listCompletedByTicker(ticker, limit) {
      const rows = await database
        .select()
        .from(schema.valuationJobs)
        .where(
          and(
            eq(schema.valuationJobs.ticker, ticker),
            eq(schema.valuationJobs.status, "completed"),
          ),
        )
        .orderBy(desc(schema.valuationJobs.createdAt))
        .limit(Math.min(limit, VALUATION_HISTORY_LIMIT));

      return rows.map(toDomain);
    },
    async insert(job) {
      try {
        await database.insert(schema.valuationJobs).values(toInsert(job));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ValuationJobConflictError();
        }

        throw error;
      }

      return job;
    },
    async claim(claim: ValuationJobClaim) {
      const rows = await database
        .update(schema.valuationJobs)
        .set({
          status: "running",
          startedAt: at(claim.startedAt),
          heartbeatAt: null,
          claimToken: claim.claimToken,
        })
        .where(
          and(
            eq(schema.valuationJobs.jobId, claim.jobId),
            or(
              eq(schema.valuationJobs.status, "queued"),
              and(
                eq(schema.valuationJobs.status, "running"),
                // Viejo por el último signo de vida, no por el arranque.
                or(
                  and(
                    isNull(schema.valuationJobs.heartbeatAt),
                    lt(schema.valuationJobs.startedAt, at(claim.staleBefore)),
                  ),
                  lt(schema.valuationJobs.heartbeatAt, at(claim.staleBefore)),
                ),
              ),
            ),
          ),
        )
        .returning();

      return rows[0] === undefined ? null : toDomain(rows[0]);
    },
    async finish(input: ValuationJobFinish) {
      return database.transaction(async (transaction) => {
        const rows = await transaction
          .update(schema.valuationJobs)
          .set({
            status: "completed",
            claimToken: null,
            finishedAt: at(input.finishedAt),
            identityStatus: input.outcome.identityStatus,
            legalEntityId: input.outcome.legalEntityId,
            securityId: input.outcome.securityId,
            listingId: input.outcome.listingId,
            gap: input.outcome.gap,
            methodStatus: input.outcome.methodStatus,
            assetProfile: input.outcome.assetProfile,
            method: input.outcome.method,
            rigor: input.outcome.rigor,
            unsupportedReason: input.outcome.unsupportedReason,
            snapshotGap: input.outcome.snapshotGap,
            valuationRunId: input.outcome.valuationRunId,
            runStatus: input.outcome.runStatus,
            dataStep: input.outcome.dataStep,
            qualitativeStep: input.outcome.qualitativeStep,
            // El job termina bajo la regla del worker que lo corrió.
            ruleVersion: VALUATION_JOB_RULE_VERSION,
          })
          .where(
            and(
              eq(schema.valuationJobs.jobId, input.jobId),
              eq(schema.valuationJobs.status, "running"),
              eq(schema.valuationJobs.claimToken, input.claimToken),
            ),
          )
          .returning({ jobId: schema.valuationJobs.jobId });

        if (rows.length !== 1) {
          return "lost" as const;
        }

        if (input.followUp !== undefined) {
          try {
            await transaction
              .insert(schema.valuationJobs)
              .values(toInsert(input.followUp));
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ValuationJobConflictError();
            }

            throw error;
          }
        }

        return "completed" as const;
      });
    },
    async beat(input: ValuationJobBeat) {
      const rows = await database
        .update(schema.valuationJobs)
        .set({ heartbeatAt: at(input.at) })
        .where(
          and(
            eq(schema.valuationJobs.jobId, input.jobId),
            eq(schema.valuationJobs.status, "running"),
            eq(schema.valuationJobs.claimToken, input.claimToken),
          ),
        )
        .returning({ jobId: schema.valuationJobs.jobId });

      return rows.length === 1 ? "alive" : "lost";
    },
  };
}
