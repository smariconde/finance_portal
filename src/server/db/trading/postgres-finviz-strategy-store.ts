import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { FinvizStrategyStore } from "@/modules/finviz-screener/application/finviz-strategy-store";
import {
  sameStrategyFields,
  type StoredFinvizStrategy,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type StrategyRow = typeof schema.finvizScreenerStrategies.$inferSelect;

const NAME_INDEX = "finviz_screener_strategies_name_uidx";

function violatedIndex(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && error.code === "23505")
    return "constraint_name" in error &&
      typeof error.constraint_name === "string"
      ? error.constraint_name
      : "";
  return "cause" in error ? violatedIndex(error.cause) : null;
}

function toStored(row: StrategyRow): StoredFinvizStrategy {
  return {
    strategyId: row.strategyId,
    revision: row.revision,
    version: row.version,
    catalogVersion: row.catalogVersion,
    name: row.name,
    view: row.view as StoredFinvizStrategy["view"],
    signal: row.signal as StoredFinvizStrategy["signal"],
    filters: row.filters,
    recordedAt: row.recordedAt.toISOString(),
  };
}

class Conflict extends Error {}

/**
 * Las estrategias de Finviz en la base de trading (`F11-13`). Cada escritura es
 * una transacción corta con `for update` sobre la vigente, como las reglas y
 * las ideas; el nombre único entre las activas lo garantiza un índice parcial.
 */
export function createPostgresFinvizStrategyStore(
  database: Database,
): FinvizStrategyStore {
  const strategies = schema.finvizScreenerStrategies;

  async function append(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    current: StrategyRow | undefined,
    values: Omit<
      typeof strategies.$inferInsert,
      "revisionId" | "revision" | "supersededAt"
    >,
  ) {
    if (current !== undefined)
      await transaction
        .update(strategies)
        .set({
          supersededAt:
            values.recordedAt < current.recordedAt
              ? current.recordedAt
              : values.recordedAt,
        })
        .where(eq(strategies.revisionId, current.revisionId));
    const [row] = await transaction
      .insert(strategies)
      .values({
        ...values,
        revisionId: randomUUID(),
        revision: (current?.revision ?? 0) + 1,
      })
      .returning();
    return row!;
  }

  function lockCurrent(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    strategyId: string,
  ) {
    return transaction
      .select()
      .from(strategies)
      .where(
        and(
          eq(strategies.strategyId, strategyId),
          isNull(strategies.supersededAt),
        ),
      )
      .for("update")
      .limit(1);
  }

  return {
    async listActive() {
      const rows = await database
        .select()
        .from(strategies)
        .where(
          and(isNull(strategies.supersededAt), eq(strategies.status, "active")),
        )
        .orderBy(asc(sql`lower(${strategies.name})`), asc(strategies.name));
      return rows.map(toStored);
    },
    async save(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [current] = await lockCurrent(transaction, input.strategyId);
          if (
            (current?.revision ?? null) !== input.baseRevision ||
            current?.status === "archived"
          )
            throw new Conflict();
          if (
            current !== undefined &&
            sameStrategyFields(toStored(current), input.fields)
          )
            return { state: "unchanged" as const, strategy: toStored(current) };
          const row = await append(transaction, current, {
            strategyId: input.strategyId,
            version: input.version,
            catalogVersion: input.catalogVersion,
            ...input.fields,
            status: "active",
            recordedAt: new Date(input.recordedAt),
          });
          return { state: "saved" as const, strategy: toStored(row) };
        });
      } catch (error) {
        if (error instanceof Conflict) return { state: "conflict" };
        const index = violatedIndex(error);
        if (index === NAME_INDEX) return { state: "name_taken" };
        if (index !== null) return { state: "conflict" };
        throw error;
      }
    },
    async archive(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [current] = await lockCurrent(transaction, input.strategyId);
          if (
            current === undefined ||
            current.status === "archived" ||
            current.revision !== input.baseRevision
          )
            return "conflict" as const;
          const { revisionId, revision, supersededAt, ...kept } = current;
          void revisionId;
          void revision;
          void supersededAt;
          await append(transaction, current, {
            ...kept,
            status: "archived",
            recordedAt: new Date(input.recordedAt),
          });
          return "archived" as const;
        });
      } catch (error) {
        if (violatedIndex(error) !== null) return "conflict";
        throw error;
      }
    },
  };
}
