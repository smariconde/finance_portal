import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  StoredAnnotation,
  TradeAnnotationStore,
} from "@/modules/trading/application/trade-annotation-store";
import {
  sameAnnotation,
  tradeAnnotationSchema,
} from "@/modules/trading/domain/trade-annotation";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type AnnotationRow = typeof schema.tradeAnnotations.$inferSelect;

const key = (hex: string) => Buffer.from(hex, "hex");
const hex = (bytes: Buffer) => Buffer.from(bytes).toString("hex");

/** PostgreSQL devuelve `numeric` con la escala guardada: se canoniza al leer. */
function canonical(value: string | null): string | null {
  if (value === null || !value.includes(".")) return value;
  return value.replace(/0+$/u, "").replace(/\.$/u, "");
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function toStored(row: AnnotationRow): StoredAnnotation {
  const annotation = tradeAnnotationSchema.parse({
    setupCode: row.setupCode,
    plan: {
      entry: canonical(row.planEntry),
      stop: canonical(row.planStop),
      target: canonical(row.planTarget),
      quantity: canonical(row.planQuantity),
    },
    adherence: {
      entry: row.adherenceEntry,
      stop: row.adherenceStop,
      target: row.adherenceTarget,
      size: row.adherenceSize,
    },
    emotion: row.emotion,
    review: row.review,
    notes: row.notes,
  });
  return {
    ...annotation,
    accountKey: hex(row.accountKey),
    tradeKey: row.tradeKey,
    revision: row.revision,
    version: row.version,
    recordedAt: row.recordedAt.toISOString(),
  };
}

class Conflict extends Error {}

/**
 * Anotaciones del diario en la base de trading (`F11-07`). Guardar es una
 * transacción corta: lee la vigente con `for update`, compara la revisión que el
 * owner editaba y supersede o no escribe nada. Dos primeras revisiones a la vez
 * chocan en el índice de la vigente y la segunda vuelve como conflicto.
 */
export function createPostgresTradeAnnotationStore(
  database: Database,
): TradeAnnotationStore {
  const table = schema.tradeAnnotations;

  async function readCurrent(accountKey: string, tradeKey: string) {
    const [row] = await database
      .select()
      .from(table)
      .where(
        and(
          eq(table.accountKey, key(accountKey)),
          eq(table.tradeKey, tradeKey),
          isNull(table.supersededAt),
        ),
      )
      .limit(1);
    return row === undefined ? null : toStored(row);
  }

  return {
    async listCurrentAnnotations(accountKey) {
      const rows = await database
        .select()
        .from(table)
        .where(
          and(
            eq(table.accountKey, key(accountKey)),
            isNull(table.supersededAt),
          ),
        )
        .orderBy(asc(table.tradeKey));
      return rows.map(toStored);
    },
    async listAnnotationRevisions(accountKey, tradeKey) {
      const rows = await database
        .select()
        .from(table)
        .where(
          and(
            eq(table.accountKey, key(accountKey)),
            eq(table.tradeKey, tradeKey),
          ),
        )
        .orderBy(desc(table.revision));
      return rows.map(toStored);
    },
    async saveAnnotation(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [currentRow] = await transaction
            .select()
            .from(table)
            .where(
              and(
                eq(table.accountKey, key(input.accountKey)),
                eq(table.tradeKey, input.tradeKey),
                isNull(table.supersededAt),
              ),
            )
            .for("update")
            .limit(1);
          const current =
            currentRow === undefined ? null : toStored(currentRow);
          if ((current?.revision ?? null) !== input.baseRevision) {
            throw new Conflict();
          }
          if (current !== null && sameAnnotation(current, input.annotation)) {
            return { state: "unchanged" as const, annotation: current };
          }

          const recordedAt = new Date(input.recordedAt);
          if (currentRow !== undefined) {
            await transaction
              .update(table)
              .set({
                supersededAt:
                  recordedAt < currentRow.recordedAt
                    ? currentRow.recordedAt
                    : recordedAt,
              })
              .where(eq(table.revisionId, currentRow.revisionId));
          }
          const value = input.annotation;
          const [row] = await transaction
            .insert(table)
            .values({
              revisionId: randomUUID(),
              accountKey: key(input.accountKey),
              tradeKey: input.tradeKey,
              revision: (current?.revision ?? 0) + 1,
              version: input.version,
              setupCode: value.setupCode,
              planEntry: value.plan.entry,
              planStop: value.plan.stop,
              planTarget: value.plan.target,
              planQuantity: value.plan.quantity,
              adherenceEntry: value.adherence.entry,
              adherenceStop: value.adherence.stop,
              adherenceTarget: value.adherence.target,
              adherenceSize: value.adherence.size,
              emotion: value.emotion,
              review: value.review,
              notes: value.notes,
              recordedAt,
            })
            .returning();
          return { state: "saved" as const, annotation: toStored(row!) };
        });
      } catch (error) {
        if (error instanceof Conflict || isUniqueViolation(error)) {
          return {
            state: "conflict",
            current: await readCurrent(input.accountKey, input.tradeKey),
          };
        }
        throw error;
      }
    },
    async listOwnSetups() {
      const rows = await database
        .select()
        .from(schema.tradingSetups)
        .orderBy(asc(schema.tradingSetups.code));
      return rows.map((row) => ({
        code: row.code,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async createOwnSetup(setup, limit) {
      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select({ code: schema.tradingSetups.code })
          .from(schema.tradingSetups)
          .where(eq(schema.tradingSetups.code, setup.code))
          .limit(1);
        if (existing !== undefined) return "exists" as const;
        const [{ total }] = (await transaction
          .select({ total: count() })
          .from(schema.tradingSetups)) as [{ total: number }];
        if (total >= limit) return "limit_reached" as const;
        const inserted = await transaction
          .insert(schema.tradingSetups)
          .values({
            code: setup.code,
            label: setup.label,
            createdAt: new Date(setup.createdAt),
          })
          .onConflictDoNothing()
          .returning({ code: schema.tradingSetups.code });
        return inserted.length === 0
          ? ("exists" as const)
          : ("created" as const);
      });
    },
  };
}
