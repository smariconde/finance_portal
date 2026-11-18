import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  CONSENSUS_DATASET_ID,
  type ConsensusRepository,
} from "@/modules/consensus/application/consensus-repository";
import type {
  ConsensusRevision,
  ConsensusValues,
} from "@/modules/consensus/domain/consensus-revisions";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type Row = typeof schema.consensusEstimates.$inferSelect;

/** `numeric` comes back as PostgreSQL prints it; trailing zeros are noise. */
function decimalText(value: string | null): string | null {
  if (value === null) return null;
  return value.includes(".") ? value.replace(/\.?0+$/u, "") : value;
}

function toDomain(row: Row): ConsensusRevision {
  const values: ConsensusValues | null = row.withdrawn
    ? null
    : {
        epsAverage: decimalText(row.epsAverage)!,
        epsHigh: decimalText(row.epsHigh),
        epsLow: decimalText(row.epsLow),
        epsAnalystCount: row.epsAnalystCount,
        epsAverage7DaysAgo: decimalText(row.epsAverage7DaysAgo),
        epsAverage30DaysAgo: decimalText(row.epsAverage30DaysAgo),
        epsAverage60DaysAgo: decimalText(row.epsAverage60DaysAgo),
        epsAverage90DaysAgo: decimalText(row.epsAverage90DaysAgo),
        epsRevisionsUp7Days: row.epsRevisionsUp7Days,
        epsRevisionsDown7Days: row.epsRevisionsDown7Days,
        epsRevisionsUp30Days: row.epsRevisionsUp30Days,
        epsRevisionsDown30Days: row.epsRevisionsDown30Days,
        revenueAverage: decimalText(row.revenueAverage),
        revenueHigh: decimalText(row.revenueHigh),
        revenueLow: decimalText(row.revenueLow),
        revenueAnalystCount: row.revenueAnalystCount,
      };
  return {
    securityId: row.securityId,
    periodEnd: row.periodEnd,
    revision: row.revision,
    values,
    availableAt: row.availableAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    ingestionRunId: row.ingestionRunId,
  };
}

function toRow(
  revision: Omit<ConsensusRevision, "ingestionRunId">,
  ingestionRunId: string,
): typeof schema.consensusEstimates.$inferInsert {
  const values = revision.values;
  return {
    securityId: revision.securityId,
    periodEnd: revision.periodEnd,
    revision: revision.revision,
    withdrawn: values === null,
    epsAverage: values?.epsAverage ?? null,
    epsHigh: values?.epsHigh ?? null,
    epsLow: values?.epsLow ?? null,
    epsAnalystCount: values?.epsAnalystCount ?? null,
    epsAverage7DaysAgo: values?.epsAverage7DaysAgo ?? null,
    epsAverage30DaysAgo: values?.epsAverage30DaysAgo ?? null,
    epsAverage60DaysAgo: values?.epsAverage60DaysAgo ?? null,
    epsAverage90DaysAgo: values?.epsAverage90DaysAgo ?? null,
    epsRevisionsUp7Days: values?.epsRevisionsUp7Days ?? null,
    epsRevisionsDown7Days: values?.epsRevisionsDown7Days ?? null,
    epsRevisionsUp30Days: values?.epsRevisionsUp30Days ?? null,
    epsRevisionsDown30Days: values?.epsRevisionsDown30Days ?? null,
    revenueAverage: values?.revenueAverage ?? null,
    revenueHigh: values?.revenueHigh ?? null,
    revenueLow: values?.revenueLow ?? null,
    revenueAnalystCount: values?.revenueAnalystCount ?? null,
    availableAt: new Date(revision.availableAt),
    supersededAt: null,
    ingestionRunId,
  };
}

/** Consensus revision chains and the owner's thresholds (ADR 0083). */
export function createPostgresConsensusRepository(
  database: Database,
): ConsensusRepository {
  const table = schema.consensusEstimates;
  const thresholds = schema.ownerMultipleThresholds;
  const runs = schema.ingestionRuns;

  return {
    storage: "personal-postgres",

    async loadOpen(securityId) {
      const rows = await database
        .select()
        .from(table)
        .where(
          and(eq(table.securityId, securityId), isNull(table.supersededAt)),
        )
        .orderBy(asc(table.periodEnd));
      return rows.map(toDomain);
    },

    async loadRevisions(securityId) {
      // Two fiscal years a capture, and a revision only when a number moves:
      // a few hundred rows a year at most.
      const rows = await database
        .select()
        .from(table)
        .where(eq(table.securityId, securityId))
        .orderBy(asc(table.periodEnd), asc(table.revision))
        .limit(5_000);
      return rows.map(toDomain);
    },

    async apply(plan, ingestionRunId) {
      if (plan.inserts.length === 0) return;
      await database.transaction(async (tx) => {
        for (const closed of plan.supersede) {
          const insert = plan.inserts.find(
            (row) => row.periodEnd === closed.periodEnd,
          );
          if (insert === undefined) {
            throw new Error("consensus_open_revision_missing");
          }
          const updated = await tx
            .update(table)
            .set({ supersededAt: new Date(insert.availableAt) })
            .where(
              and(
                eq(table.securityId, insert.securityId),
                eq(table.periodEnd, closed.periodEnd),
                eq(table.revision, closed.revision),
                isNull(table.supersededAt),
              ),
            )
            .returning({ revision: table.revision });
          // Another capture closed it first: this one aborts whole.
          if (updated.length !== 1) {
            throw new Error("consensus_open_revision_missing");
          }
        }
        await tx
          .insert(table)
          .values(plan.inserts.map((row) => toRow(row, ingestionRunId)));
      });
    },

    async captures(securityId) {
      const rows = await database
        .select({ finishedAt: runs.finishedAt })
        .from(runs)
        .where(
          and(
            eq(runs.datasetId, CONSENSUS_DATASET_ID),
            eq(runs.subjectKey, securityId),
            inArray(runs.status, ["succeeded", "duplicate"]),
          ),
        )
        .orderBy(asc(runs.finishedAt))
        .limit(5_000);
      return rows
        .map((row) => row.finishedAt?.toISOString() ?? null)
        .filter((value): value is string => value !== null);
    },

    async loadThresholds(legalEntityId, metric) {
      const rows = await database
        .select()
        .from(thresholds)
        .where(
          and(
            eq(thresholds.legalEntityId, legalEntityId),
            eq(thresholds.metric, metric),
          ),
        )
        .orderBy(asc(thresholds.declaredAt))
        .limit(500);
      return rows.map((row) => ({
        legalEntityId: row.legalEntityId,
        metric,
        value: decimalText(row.value),
        reason: row.reason,
        declaredAt: row.declaredAt.toISOString(),
      }));
    },

    async declareThreshold(threshold) {
      await database.insert(thresholds).values({
        thresholdId: threshold.thresholdId,
        legalEntityId: threshold.legalEntityId,
        metric: threshold.metric,
        value: threshold.value,
        reason: threshold.reason,
        declaredAt: new Date(threshold.declaredAt),
      });
    },
  };
}
