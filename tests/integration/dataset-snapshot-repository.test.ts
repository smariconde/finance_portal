import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatasetSnapshotRepository } from "@/server/db/postgres-dataset-snapshot-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

describe("PostgresDatasetSnapshotRepository", () => {
  const datasetId = `integration.${randomUUID()}`;
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
  });

  afterAll(async () => {
    if (database) {
      await database
        .delete(schema.datasetSnapshots)
        .where(eq(schema.datasetSnapshots.datasetId, datasetId));
    }
    if (client) {
      await client.end();
    }
  });

  it("reads a temporal snapshot without coercing a missing manifest", async () => {
    const snapshotId = randomUUID();
    await database.insert(schema.datasetSnapshots).values({
      snapshotId,
      datasetId,
      version: "integration-v1",
      validFrom: new Date("2026-08-21T00:00:00.000Z"),
      availableAt: new Date("2026-08-21T01:00:00.000Z"),
      recordedAt: new Date("2026-08-21T02:00:00.000Z"),
      manifest: null,
      manifestStatus: "not_provided",
      contentHash: "b".repeat(64),
    });

    const repository = createPostgresDatasetSnapshotRepository(database);

    await expect(repository.findById(snapshotId)).resolves.toMatchObject({
      snapshotId,
      manifest: null,
      manifestStatus: "not_provided",
    });
  });
});
