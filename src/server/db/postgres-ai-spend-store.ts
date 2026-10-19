import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  AiSpendSettlementError,
  type AiSpendStore,
} from "@/modules/ai/application/ai-spend-store";
import {
  admitAiSpend,
  aiSpendReservationRequestSchema,
  aiSpendSettlementSchema,
  AI_SPEND_LIMITS,
  declaredSpendLimits,
  resolveEffectiveDailySpendLimit,
  type AiAttemptOutcome,
  type AiSpendEntry,
  type DeclaredSpendLimits,
} from "@/modules/ai/domain/ai-spend";
import {
  budgetDayOf,
  nextBudgetDayStart,
  type SourceControl,
} from "@/modules/ingestion/domain/source-budget";

import { toDomainControl } from "./postgres-source-budget-store";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Libro de gasto personal (ADR 0033).
 *
 * Cada reserva toma `pg_advisory_xact_lock` por fuente antes de leer lo gastado,
 * así que la suma que decide y la fila que se escribe son de la misma vista: dos
 * procesos no pueden reservar los dos el último dólar del día. El espacio del
 * lock es propio y no el de los jobs de ingesta, que protegen otra cosa.
 */
const AI_SPEND_LOCK_NAMESPACE = 20_533;

/** Lo que una fila cuenta, en SQL: mismo criterio que `countedNanoUsd`. */
const COUNTED = sql<number>`coalesce(sum(case
  when ${schema.aiSpendLedger.status} = 'charged' then ${schema.aiSpendLedger.chargedNanoUsd}
  when ${schema.aiSpendLedger.status} = 'uncharged' then 0
  else ${schema.aiSpendLedger.reservedNanoUsd}
end), 0)::bigint`.mapWith(Number);

function toDomainEntry(
  row: typeof schema.aiSpendLedger.$inferSelect,
): AiSpendEntry {
  return {
    reservationId: row.reservationId,
    sourceId: row.sourceId,
    taskRunId: row.taskRunId,
    purpose: row.purpose,
    taskVersion: row.taskVersion,
    ladderVersion: row.ladderVersion,
    rung: row.rung,
    requestedModel: row.requestedModel,
    respondedModel: row.respondedModel,
    day: row.spendOn,
    status: row.status,
    reservedNanoUsd: row.reservedNanoUsd,
    chargedNanoUsd: row.chargedNanoUsd,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    latencyMs: row.latencyMs,
    outcome: row.outcome as AiAttemptOutcome | null,
    reservedAt: row.reservedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

export function createPostgresAiSpendStore(
  database: Database,
  limits: DeclaredSpendLimits = AI_SPEND_LIMITS,
): AiSpendStore {
  async function currentControl(
    executor: Database | Transaction,
    sourceId: string,
  ): Promise<SourceControl | null> {
    const [row] = await executor
      .select()
      .from(schema.ingestionSourceControls)
      .where(
        and(
          eq(schema.ingestionSourceControls.sourceId, sourceId),
          isNull(schema.ingestionSourceControls.supersededAt),
        ),
      )
      .limit(1);

    return row ? toDomainControl(row) : null;
  }

  return {
    storage: "personal-postgres",
    async reserve(request) {
      const parsed = aiSpendReservationRequestSchema.parse(request);
      const day = budgetDayOf(parsed.now);

      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${AI_SPEND_LOCK_NAMESPACE}::int4, hashtext(${parsed.sourceId}::text))`,
        );

        const [task] = await tx
          .select({ counted: COUNTED })
          .from(schema.aiSpendLedger)
          .where(eq(schema.aiSpendLedger.taskRunId, parsed.taskRunId));
        const [ofDay] = await tx
          .select({ counted: COUNTED })
          .from(schema.aiSpendLedger)
          .where(
            and(
              eq(schema.aiSpendLedger.sourceId, parsed.sourceId),
              eq(schema.aiSpendLedger.spendOn, day),
            ),
          );
        const taskSpentNanoUsd = task?.counted ?? 0;
        const daySpentNanoUsd = ofDay?.counted ?? 0;
        const refusal = admitAiSpend({
          limits: declaredSpendLimits(parsed.sourceId, limits),
          control: await currentControl(tx, parsed.sourceId),
          taskSpentNanoUsd,
          daySpentNanoUsd,
          worstCaseNanoUsd: parsed.worstCaseNanoUsd,
          resumesAt: nextBudgetDayStart(parsed.now),
        });

        if (refusal !== null) {
          return refusal;
        }

        await tx.insert(schema.aiSpendLedger).values({
          reservationId: parsed.reservationId,
          sourceId: parsed.sourceId,
          taskRunId: parsed.taskRunId,
          purpose: parsed.purpose,
          taskVersion: parsed.taskVersion,
          ladderVersion: parsed.ladderVersion,
          rung: parsed.rung,
          requestedModel: parsed.requestedModel,
          spendOn: day,
          status: "reserved",
          reservedNanoUsd: parsed.worstCaseNanoUsd,
          reservedAt: new Date(parsed.now),
        });

        return {
          status: "reserved" as const,
          reservationId: parsed.reservationId,
          taskSpentNanoUsd: taskSpentNanoUsd + parsed.worstCaseNanoUsd,
          daySpentNanoUsd: daySpentNanoUsd + parsed.worstCaseNanoUsd,
        };
      });
    },
    async settle(settlement) {
      const parsed = aiSpendSettlementSchema.parse(settlement);

      // Condicionada a `reserved`: una liquidación nunca pisa otra.
      const [row] = await database
        .update(schema.aiSpendLedger)
        .set({
          status: parsed.status,
          chargedNanoUsd: parsed.chargedNanoUsd,
          respondedModel: parsed.respondedModel,
          promptTokens: parsed.promptTokens,
          completionTokens: parsed.completionTokens,
          latencyMs: parsed.latencyMs,
          outcome: parsed.outcome,
          settledAt: new Date(parsed.now),
        })
        .where(
          and(
            eq(schema.aiSpendLedger.reservationId, parsed.reservationId),
            eq(schema.aiSpendLedger.status, "reserved"),
          ),
        )
        .returning();

      if (row !== undefined) {
        return toDomainEntry(row);
      }

      const [existing] = await database
        .select({ status: schema.aiSpendLedger.status })
        .from(schema.aiSpendLedger)
        .where(eq(schema.aiSpendLedger.reservationId, parsed.reservationId))
        .limit(1);

      throw new AiSpendSettlementError(
        parsed.reservationId,
        existing === undefined ? "unknown" : "already_settled",
      );
    },
    async readDay(sourceId, now) {
      const day = budgetDayOf(now);
      const declared = declaredSpendLimits(sourceId, limits);
      const [totals] = await database
        .select({
          counted: COUNTED,
          charged:
            sql<number>`coalesce(sum(${schema.aiSpendLedger.chargedNanoUsd}), 0)::bigint`.mapWith(
              Number,
            ),
          attempts: sql<number>`count(*)::int`.mapWith(Number),
          open: sql<number>`count(*) filter (where ${schema.aiSpendLedger.status} = 'reserved')::int`.mapWith(
            Number,
          ),
        })
        .from(schema.aiSpendLedger)
        .where(
          and(
            eq(schema.aiSpendLedger.sourceId, sourceId),
            eq(schema.aiSpendLedger.spendOn, day),
          ),
        );

      return {
        sourceId,
        day,
        declared,
        effectiveDailyLimitNanoUsd:
          declared === null
            ? null
            : resolveEffectiveDailySpendLimit(
                declared,
                await currentControl(database, sourceId),
              ),
        countedNanoUsd: totals?.counted ?? 0,
        chargedNanoUsd: totals?.charged ?? 0,
        attempts: totals?.attempts ?? 0,
        openReservations: totals?.open ?? 0,
      };
    },
    async listTaskAttempts(taskRunId) {
      const rows = await database
        .select()
        .from(schema.aiSpendLedger)
        .where(eq(schema.aiSpendLedger.taskRunId, taskRunId))
        .orderBy(
          asc(schema.aiSpendLedger.reservedAt),
          asc(schema.aiSpendLedger.rung),
        );

      return rows.map(toDomainEntry);
    },
  };
}
