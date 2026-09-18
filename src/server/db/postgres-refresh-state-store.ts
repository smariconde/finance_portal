import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  refreshCheckSchema,
  refreshStateKeySchema,
  refreshStateListQuerySchema,
  refreshStateSchema,
  type RefreshState,
  type RefreshStateKey,
  type RefreshStateStore,
} from "@/modules/ingestion/application/refresh-state-store";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;
type RefreshStateRow = typeof schema.ingestionRefreshState.$inferSelect;

function toDomain(row: RefreshStateRow): RefreshState {
  return refreshStateSchema.parse({
    sourceId: row.sourceId,
    datasetId: row.datasetId,
    subjectKey: row.subjectKey,
    watermarkAcceptedAt: row.watermarkAcceptedAt.toISOString(),
    watermarkAccession: row.watermarkAccession,
    formSelectionVersion: row.formSelectionVersion,
    probeVersion: row.probeVersion,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
    lastChangedAt: row.lastChangedAt.toISOString(),
    probeRunId: row.probeRunId,
    refreshRunId: row.refreshRunId,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toRow(
  state: RefreshState,
): typeof schema.ingestionRefreshState.$inferInsert {
  return {
    sourceId: state.sourceId,
    datasetId: state.datasetId,
    subjectKey: state.subjectKey,
    watermarkAcceptedAt: new Date(state.watermarkAcceptedAt),
    watermarkAccession: state.watermarkAccession,
    formSelectionVersion: state.formSelectionVersion,
    probeVersion: state.probeVersion,
    lastCheckedAt: new Date(state.lastCheckedAt),
    lastChangedAt: new Date(state.lastChangedAt),
    probeRunId: state.probeRunId,
    refreshRunId: state.refreshRunId,
    updatedAt: new Date(state.updatedAt),
  };
}

export function createPostgresRefreshStateStore(
  database: Database,
): RefreshStateStore {
  const table = schema.ingestionRefreshState;
  const matches = (key: RefreshStateKey) =>
    and(
      eq(table.sourceId, key.sourceId),
      eq(table.datasetId, key.datasetId),
      eq(table.subjectKey, key.subjectKey),
    );

  async function find(key: RefreshStateKey): Promise<RefreshState | null> {
    const [row] = await database.select().from(table).where(matches(key));

    return row === undefined ? null : toDomain(row);
  }

  return {
    storage: "personal-postgres",
    find: (key) => find(refreshStateKeySchema.parse(key)),
    async list(query) {
      const parsedQuery = refreshStateListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(table)
        .where(
          and(
            eq(table.sourceId, parsedQuery.sourceId),
            eq(table.datasetId, parsedQuery.datasetId),
          ),
        )
        .orderBy(asc(table.subjectKey))
        .limit(parsedQuery.limit);

      return rows.map(toDomain);
    },
    async record(state) {
      const parsed = refreshStateSchema.parse(state);
      const row = toRow(parsed);
      // El `where` del upsert es la regla de que un sondeo más viejo no pisa la
      // marca: sin él, la escritura tardía de un proceso que quedó atrás haría
      // retroceder lo que otro ya sabía. Si no entra, no vuelve fila.
      const [written] = await database
        .insert(table)
        .values(row)
        .onConflictDoUpdate({
          target: [table.sourceId, table.datasetId, table.subjectKey],
          set: {
            watermarkAcceptedAt: row.watermarkAcceptedAt,
            watermarkAccession: row.watermarkAccession,
            formSelectionVersion: row.formSelectionVersion,
            probeVersion: row.probeVersion,
            lastCheckedAt: row.lastCheckedAt,
            lastChangedAt: row.lastChangedAt,
            probeRunId: row.probeRunId,
            refreshRunId: row.refreshRunId,
            updatedAt: row.updatedAt,
          },
          where: lte(table.lastCheckedAt, row.lastCheckedAt),
        })
        .returning();

      return written === undefined ? (await find(parsed))! : toDomain(written);
    },
    async touch(check) {
      const parsed = refreshCheckSchema.parse(check);
      const checkedAt = new Date(parsed.checkedAt);
      const [written] = await database
        .update(table)
        .set({
          probeVersion: parsed.probeVersion,
          lastCheckedAt: checkedAt,
          probeRunId: parsed.probeRunId,
          updatedAt: checkedAt,
        })
        .where(and(matches(parsed), lte(table.lastCheckedAt, checkedAt)))
        .returning();

      return written === undefined ? await find(parsed) : toDomain(written);
    },
  };
}
