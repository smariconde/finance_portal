import "server-only";

import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  datasetSnapshotListQuerySchema,
  type DatasetSnapshotRepository,
} from "@/modules/persistence/application/dataset-snapshot-repository";
import { datasetSnapshotSchema } from "@/modules/persistence/domain/dataset-snapshot";

import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

function toDomainSnapshot(row: typeof schema.datasetSnapshots.$inferSelect) {
  return datasetSnapshotSchema.parse({
    ...row,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    availableAt: row.availableAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
  });
}

export function createPostgresDatasetSnapshotRepository(
  database: Database,
): DatasetSnapshotRepository {
  return {
    storage: "personal-postgres",
    async findById(snapshotId) {
      const parsedSnapshotId =
        datasetSnapshotSchema.shape.snapshotId.parse(snapshotId);
      const [row] = await database
        .select()
        .from(schema.datasetSnapshots)
        .where(eq(schema.datasetSnapshots.snapshotId, parsedSnapshotId))
        .limit(1);

      return row ? toDomainSnapshot(row) : null;
    },
    async list(query) {
      const parsedQuery = datasetSnapshotListQuerySchema.parse(query);
      const rows = await database
        .select()
        .from(schema.datasetSnapshots)
        .where(eq(schema.datasetSnapshots.datasetId, parsedQuery.datasetId))
        .orderBy(desc(schema.datasetSnapshots.availableAt))
        .limit(parsedQuery.limit);

      return rows.map(toDomainSnapshot);
    },
  };
}
