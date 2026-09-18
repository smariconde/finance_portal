import "server-only";

import { and, asc, between, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  sourceControlChangeSchema,
  sourceUsageWindowSchema,
  type SourceBudgetStore,
  type SourceDailyUsage,
} from "@/modules/ingestion/application/source-budget-store";
import {
  budgetDayOf,
  declaredDailyBudget,
  nextBudgetDayStart,
  resolveEffectiveDailyLimit,
  sourceControlSchema,
  SOURCE_DAILY_REQUEST_BUDGETS,
  type DeclaredDailyBudgets,
  type SourceBudgetState,
  type SourceControl,
} from "@/modules/ingestion/domain/source-budget";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

function toDomainControl(
  row: typeof schema.ingestionSourceControls.$inferSelect,
): SourceControl {
  return sourceControlSchema.parse({
    controlId: row.controlId,
    sourceId: row.sourceId,
    status: row.status,
    dailyRequestLimit: row.dailyRequestLimit,
    reason: row.reason,
    actor: row.actor,
    recordedAt: row.recordedAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  });
}

export function createPostgresSourceBudgetStore(
  database: Database,
  budgets: DeclaredDailyBudgets = SOURCE_DAILY_REQUEST_BUDGETS,
): SourceBudgetStore {
  async function currentControl(
    executor: Database,
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

  async function usedOn(
    executor: Database,
    sourceId: string,
    day: string,
  ): Promise<number> {
    const [row] = await executor
      .select({ requests: schema.ingestionSourceBudgets.requests })
      .from(schema.ingestionSourceBudgets)
      .where(
        and(
          eq(schema.ingestionSourceBudgets.sourceId, sourceId),
          eq(schema.ingestionSourceBudgets.usageOn, day),
        ),
      )
      .limit(1);

    return row?.requests ?? 0;
  }

  async function stateOf(
    executor: Database,
    sourceId: string,
    now: string,
  ): Promise<SourceBudgetState> {
    const control = await currentControl(executor, sourceId);
    const day = budgetDayOf(now);

    return {
      sourceId,
      day,
      used: await usedOn(executor, sourceId, day),
      declaredLimit: declaredDailyBudget(sourceId, budgets),
      effectiveLimit: resolveEffectiveDailyLimit(sourceId, control, budgets),
      control,
    };
  }

  return {
    storage: "personal-postgres",
    async readState(sourceId, now) {
      return stateOf(database, sourceId, now);
    },
    async consume(sourceId, now) {
      const control = await currentControl(database, sourceId);

      if (control?.status === "disabled") {
        return { status: "source_disabled", reason: control.reason };
      }

      const limit = resolveEffectiveDailyLimit(sourceId, control, budgets);

      if (limit === null) {
        return { status: "budget_undeclared" };
      }

      const day = budgetDayOf(now);

      if (limit === 0) {
        return {
          status: "daily_budget_exhausted",
          limit,
          used: await usedOn(database, sourceId, day),
          resumesAt: nextBudgetDayStart(now),
        };
      }

      // Una sola sentencia: el incremento está condicionado al tope, así que dos
      // procesos concurrentes no pueden pasarse. PostgreSQL serializa el upsert
      // sobre la misma clave y el que llega tarde no recibe fila.
      const rows = await database.execute<{ requests: number }>(sql`
        insert into ${schema.ingestionSourceBudgets}
          (source_id, usage_on, requests, first_request_at, last_request_at)
        values (${sourceId}, ${day}::date, 1, ${now}::timestamptz, ${now}::timestamptz)
        on conflict (source_id, usage_on) do update
          set requests = ${schema.ingestionSourceBudgets}.requests + 1,
              last_request_at = excluded.last_request_at
          where ${schema.ingestionSourceBudgets}.requests < ${limit}
        returning requests
      `);

      const used = rows.at(0)?.requests;

      return used === undefined
        ? {
            status: "daily_budget_exhausted",
            limit,
            used: await usedOn(database, sourceId, day),
            resumesAt: nextBudgetDayStart(now),
          }
        : { status: "allowed", used, remaining: limit - used };
    },
    async setControl(change) {
      const parsed = sourceControlChangeSchema.parse(change);

      // Cerrar el vigente y abrir el nuevo es una sola operación: dos abiertos
      // serían dos respuestas al mismo estado, y el índice único lo impide.
      return database.transaction(async (transaction) => {
        await transaction
          .update(schema.ingestionSourceControls)
          .set({ supersededAt: new Date(parsed.now) })
          .where(
            and(
              eq(schema.ingestionSourceControls.sourceId, parsed.sourceId),
              isNull(schema.ingestionSourceControls.supersededAt),
            ),
          );

        const [row] = await transaction
          .insert(schema.ingestionSourceControls)
          .values({
            controlId: parsed.controlId,
            sourceId: parsed.sourceId,
            status: parsed.status,
            dailyRequestLimit: parsed.dailyRequestLimit,
            reason: parsed.reason,
            actor: parsed.actor,
            recordedAt: new Date(parsed.now),
            supersededAt: null,
          })
          .returning();

        return toDomainControl(row!);
      });
    },
    async listControls() {
      const rows = await database
        .select()
        .from(schema.ingestionSourceControls)
        .where(isNull(schema.ingestionSourceControls.supersededAt))
        .orderBy(asc(schema.ingestionSourceControls.sourceId));

      return rows.map(toDomainControl);
    },
    async listControlHistory(sourceId, limit = 20) {
      const rows = await database
        .select()
        .from(schema.ingestionSourceControls)
        .where(eq(schema.ingestionSourceControls.sourceId, sourceId))
        .orderBy(desc(schema.ingestionSourceControls.recordedAt))
        .limit(Math.min(Math.max(limit, 1), 200));

      return rows.map(toDomainControl);
    },
    async listUsage(window) {
      const parsed = sourceUsageWindowSchema.parse(window);
      const rows = await database
        .select()
        .from(schema.ingestionSourceBudgets)
        .where(
          and(
            eq(schema.ingestionSourceBudgets.sourceId, parsed.sourceId),
            between(
              schema.ingestionSourceBudgets.usageOn,
              parsed.fromDay,
              parsed.toDay,
            ),
          ),
        )
        .orderBy(desc(schema.ingestionSourceBudgets.usageOn))
        .limit(parsed.limit);

      return rows.map((row): SourceDailyUsage => ({
        sourceId: row.sourceId,
        day: row.usageOn,
        requests: row.requests,
        firstRequestAt: row.firstRequestAt.toISOString(),
        lastRequestAt: row.lastRequestAt.toISOString(),
      }));
    },
  };
}
