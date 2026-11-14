import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, between, count, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  StoredRoutine,
  TradingRoutineStore,
} from "@/modules/trading/application/trading-routine-store";
import { sameRoutineEntry } from "@/modules/trading/domain/trading-routine";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type RoutineRow = typeof schema.sessionRoutines.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function toStored(row: RoutineRow): StoredRoutine {
  return {
    session: row.session,
    phase: row.phase,
    revision: row.revision,
    version: row.version,
    checked: row.checked,
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
  };
}

class Conflict extends Error {}

/**
 * La rutina en la base de trading (`F11-07`). Guardar es una transacción corta
 * con `for update` sobre la vigente, como las anotaciones del diario.
 */
export function createPostgresTradingRoutineStore(
  database: Database,
): TradingRoutineStore {
  const items = schema.routineItems;
  const routines = schema.sessionRoutines;

  async function readCurrent(session: string, phase: StoredRoutine["phase"]) {
    const [row] = await database
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.session, session),
          eq(routines.phase, phase),
          isNull(routines.supersededAt),
        ),
      )
      .limit(1);
    return row === undefined ? null : toStored(row);
  }

  return {
    async listItems() {
      const rows = await database
        .select()
        .from(items)
        .orderBy(asc(items.createdAt), asc(items.itemId));
      return rows.map((row) => ({
        itemId: row.itemId,
        phase: row.phase,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        retiredAt: row.retiredAt?.toISOString() ?? null,
      }));
    },
    async addItem(item, limit) {
      return database.transaction(async (transaction) => {
        const [{ open }] = (await transaction
          .select({ open: count() })
          .from(items)
          .where(
            and(eq(items.phase, item.phase), isNull(items.retiredAt)),
          )) as [{ open: number }];
        if (open >= limit) return "limit_reached" as const;
        await transaction.insert(items).values({
          itemId: item.itemId,
          phase: item.phase,
          label: item.label,
          createdAt: new Date(item.createdAt),
        });
        return "created" as const;
      });
    },
    async retireItem(itemId, at) {
      const rows = await database
        .update(items)
        .set({ retiredAt: new Date(at) })
        .where(and(eq(items.itemId, itemId), isNull(items.retiredAt)))
        .returning({ itemId: items.itemId });
      return rows.length > 0;
    },
    async listRoutines(from, to) {
      const rows = await database
        .select()
        .from(routines)
        .where(
          and(
            between(routines.session, from, to),
            isNull(routines.supersededAt),
          ),
        )
        .orderBy(asc(routines.session), asc(routines.phase));
      return rows.map(toStored);
    },
    async saveRoutine(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [currentRow] = await transaction
            .select()
            .from(routines)
            .where(
              and(
                eq(routines.session, input.session),
                eq(routines.phase, input.phase),
                isNull(routines.supersededAt),
              ),
            )
            .for("update")
            .limit(1);
          const current =
            currentRow === undefined ? null : toStored(currentRow);
          if ((current?.revision ?? null) !== input.baseRevision) {
            throw new Conflict();
          }
          if (current !== null && sameRoutineEntry(current, input.entry)) {
            return { state: "unchanged" as const, routine: current };
          }
          const recordedAt = new Date(input.recordedAt);
          if (currentRow !== undefined) {
            await transaction
              .update(routines)
              .set({
                supersededAt:
                  recordedAt < currentRow.recordedAt
                    ? currentRow.recordedAt
                    : recordedAt,
              })
              .where(eq(routines.revisionId, currentRow.revisionId));
          }
          const [row] = await transaction
            .insert(routines)
            .values({
              revisionId: randomUUID(),
              session: input.session,
              phase: input.phase,
              revision: (current?.revision ?? 0) + 1,
              version: input.version,
              checked: [...input.entry.checked],
              note: input.entry.note,
              recordedAt,
            })
            .returning();
          return { state: "saved" as const, routine: toStored(row!) };
        });
      } catch (error) {
        if (error instanceof Conflict || isUniqueViolation(error)) {
          return {
            state: "conflict",
            current: await readCurrent(input.session, input.phase),
          };
        }
        throw error;
      }
    },
  };
}
