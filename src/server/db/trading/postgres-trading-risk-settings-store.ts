import "server-only";

import { randomUUID } from "node:crypto";

import { isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type {
  StoredRiskSettings,
  TradingRiskSettingsStore,
} from "@/modules/trading/application/trading-risk-settings-store";
import { sameRiskSettings } from "@/modules/trading/domain/trading-rules";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type SettingsRow = typeof schema.tradingRiskSettings.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function toStored(row: SettingsRow): StoredRiskSettings {
  return {
    riskPerTradePercent: row.riskPerTradePercent,
    openRiskPercent: row.openRiskPercent,
    dailyLossPercent: row.dailyLossPercent,
    maxTradesPerSession: row.maxTradesPerSession,
    maxConsecutiveLosses: row.maxConsecutiveLosses,
    revision: row.revision,
    version: row.version,
    recordedAt: row.recordedAt.toISOString(),
  };
}

class Conflict extends Error {}

/**
 * Las reglas en la base de trading (`F11-09`). Guardar es una transacción corta
 * con `for update` sobre la vigente, como la rutina y las anotaciones.
 */
export function createPostgresTradingRiskSettingsStore(
  database: Database,
): TradingRiskSettingsStore {
  const settings = schema.tradingRiskSettings;

  async function readCurrent() {
    const [row] = await database
      .select()
      .from(settings)
      .where(isNull(settings.supersededAt))
      .limit(1);
    return row === undefined ? null : toStored(row);
  }

  return {
    readCurrent,
    async save(input) {
      try {
        return await database.transaction(async (transaction) => {
          const [currentRow] = await transaction
            .select()
            .from(settings)
            .where(isNull(settings.supersededAt))
            .for("update")
            .limit(1);
          const current =
            currentRow === undefined ? null : toStored(currentRow);
          if ((current?.revision ?? null) !== input.baseRevision) {
            throw new Conflict();
          }
          if (current !== null && sameRiskSettings(current, input.settings)) {
            return { state: "unchanged" as const, settings: current };
          }
          const recordedAt = new Date(input.recordedAt);
          if (currentRow !== undefined) {
            await transaction
              .update(settings)
              .set({
                supersededAt:
                  recordedAt < currentRow.recordedAt
                    ? currentRow.recordedAt
                    : recordedAt,
              })
              .where(isNull(settings.supersededAt));
          }
          const [row] = await transaction
            .insert(settings)
            .values({
              revisionId: randomUUID(),
              revision: (current?.revision ?? 0) + 1,
              version: input.version,
              ...input.settings,
              recordedAt,
            })
            .returning();
          return { state: "saved" as const, settings: toStored(row!) };
        });
      } catch (error) {
        if (error instanceof Conflict || isUniqueViolation(error)) {
          return { state: "conflict", current: await readCurrent() };
        }
        throw error;
      }
    },
  };
}
